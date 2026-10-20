// Bundles background.ts and hook.ts with tsdown, as IIFEs like the real
// build, then runs them in VM sandboxes against fake browser APIs.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'tsdown';
import { root } from '../scripts/targets';
import type { StoredState } from '../src/lib/types';

async function bundle(name: string): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'xrl-test-'));
  try {
    await build({
      config: false,
      cwd: root,
      entry: { [name]: `src/${name}.ts` },
      format: 'iife',
      platform: 'browser',
      outDir,
      outputOptions: { entryFileNames: '[name].js' },
      dts: false,
      logLevel: 'silent',
    });
    return readFileSync(join(outDir, `${name}.js`), 'utf8');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const [BACKGROUND, HOOK] = await Promise.all([bundle('background'), bundle('hook')]);

type Listener = (...args: any[]) => unknown;

function fakeEvent() {
  const listeners: Listener[] = [];
  return { listeners, addListener: (fn: Listener) => { listeners.push(fn); } };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

function loadBackground() {
  const store: Partial<StoredState> & Record<string, unknown> = {};
  const badge: { text?: string; color?: string } = {};
  const chrome = {
    storage: {
      local: {
        get: async (keys: string[]) =>
          Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
        set: async (obj: object) => { Object.assign(store, structuredClone(obj)); },
      },
    },
    webRequest: { onHeadersReceived: fakeEvent() },
    runtime: { onMessage: fakeEvent() },
    action: {
      setBadgeText: async ({ text }: { text: string }) => { badge.text = text; },
      setBadgeBackgroundColor: async ({ color }: { color: string }) => { badge.color = color; },
    },
  };
  const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout, URL, structuredClone });
  vm.runInContext(BACKGROUND, ctx);
  const onHeaders = chrome.webRequest.onHeadersReceived.listeners[0]!;
  const onMessage = chrome.runtime.onMessage.listeners[0]!;
  return { store, badge, onHeaders, onMessage };
}

test('background: follow 429 from webRequest is stored without cookies, then merged with page error codes', async () => {
  const { store, badge, onHeaders, onMessage } = loadBackground();

  onHeaders({
    url: 'https://x.com/i/api/1.1/friendships/create.json?ext=x',
    method: 'POST',
    statusCode: 429,
    responseHeaders: [
      { name: 'x-rate-limit-limit', value: '50' },
      { name: 'x-rate-limit-remaining', value: '0' },
      { name: 'x-rate-limit-reset', value: String(Math.floor(Date.now() / 1000) + 600) },
      { name: 'set-cookie', value: 'auth_token=SECRET' },
    ],
  });
  onMessage(
    { type: 'page-response', data: { method: 'POST', path: '/i/api/1.1/friendships/create.json', status: 429, headers: {}, errors: [{ code: 88, message: 'Rate limit exceeded' }] } },
    { tab: { id: 1 }, url: 'https://x.com/someone' },
    () => {},
  );
  await settle();

  assert.equal(store.watched?.length, 1);
  const r = store.watched![0]!;
  assert.equal(r.endpoint, 'follow');
  assert.equal(r.status, 429);
  assert.equal(r.path, '/i/api/1.1/friendships/create.json');
  assert.deepEqual([...r.sources], ['webRequest', 'page']);
  assert.equal(r.errors[0]?.code, 88);
  assert.equal(r.signal?.kind, 'http429');
  assert.ok(!JSON.stringify(store).includes('SECRET'));
  assert.equal(badge.text, '!');
});

test('background: ignores page messages from other origins and non-API paths', async () => {
  const { store, onMessage } = loadBackground();
  const data = { method: 'POST', path: '/i/api/1.1/friendships/create.json', status: 200, headers: {}, errors: [] };
  onMessage({ type: 'page-response', data }, { tab: { id: 1 }, url: 'https://evil.com/' }, () => {});
  onMessage({ type: 'page-response', data: { ...data, path: '/home' } }, { tab: { id: 1 }, url: 'https://x.com/' }, () => {});
  onMessage({ type: 'page-response', data: { ...data, status: 'x' } }, { tab: { id: 1 }, url: 'https://x.com/' }, () => {});
  await settle();
  assert.equal(store.watched?.length ?? 0, 0);
});

test('background: non-watched API calls go to recent and update the per-endpoint limits table', async () => {
  const { store, onHeaders } = loadBackground();
  onHeaders({
    url: 'https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D',
    method: 'GET',
    statusCode: 200,
    responseHeaders: [
      { name: 'x-rate-limit-limit', value: '500' },
      { name: 'x-rate-limit-remaining', value: '499' },
      { name: 'x-rate-limit-reset', value: '1999999999' },
    ],
  });
  await new Promise((r) => setTimeout(r, 1100)); // batched write
  assert.equal(store.recent?.length, 1);
  assert.equal(store.limits?.['GET /i/api/graphql/*/HomeTimeline']?.remaining, 499);
});

test('background: untracked actions are dropped with recordOther off; settings are sanitized', async () => {
  const { store, onHeaders, onMessage } = loadBackground();
  await new Promise((r) => onMessage(
    { type: 'settings', patch: { actions: { like: { track: false } }, recordOther: false, custom: [{ method: 'POST', op: 'CreateRetweet' }], junk: 1 } },
    {}, r));
  assert.equal((store.settings as unknown as Record<string, unknown>).junk, undefined);
  assert.equal(store.settings?.custom[0]?.id, 'custom:POST:op:CreateRetweet');

  const hit = (path: string) => onHeaders({ url: `https://x.com${path}`, method: 'POST', statusCode: 200, responseHeaders: [] });
  hit('/i/api/graphql/h/FavoriteTweet'); // untracked + recordOther off: dropped
  hit('/i/api/graphql/h/CreateRetweet'); // custom tracked action
  hit('/i/api/graphql/h/HomeTimeline'); // dropped
  await settle();
  assert.deepEqual(store.watched?.map((r) => r.endpoint), ['custom:POST:op:CreateRetweet']);
  assert.equal(store.recent?.length ?? 0, 0);
});

interface Posted { msg: { type: string; channel: string; data?: any }; origin: string }

class FakeXHR {
  listeners: Record<string, () => void> = {};
  status = 0;
  responseType = '';
  responseText = '';
  response: unknown = null;
  getAllResponseHeaders = () => '';
  addEventListener(t: string, fn: () => void) { this.listeners[t] = fn; }
  open(..._args: unknown[]) {}
  send(..._args: unknown[]) {}
}

function loadHook(fetchImpl: (...args: unknown[]) => Promise<Response>) {
  const all: Posted[] = [];
  const listeners: Listener[] = [];
  class XHR extends FakeXHR {}
  const ctx = vm.createContext({
    document: { currentScript: { dataset: { channel: 'chan' } } },
    location: { href: 'https://x.com/home', origin: 'https://x.com' },
    fetch: fetchImpl,
    XMLHttpRequest: XHR,
    Request, Response, Headers, URL,
    postMessage: (msg: Posted['msg'], origin: string) => { all.push({ msg, origin }); },
    addEventListener: (type: string, fn: Listener) => { if (type === 'message') listeners.push(fn); },
  });
  vm.runInContext('globalThis.window = globalThis;', ctx);
  vm.runInContext(HOOK, ctx);
  const win = vm.runInContext('window', ctx) as {
    fetch: (input: string, init?: RequestInit) => Promise<Response>;
    XMLHttpRequest: typeof XHR;
  };
  const responses = () => all.filter((p) => p.msg.type === 'xrl-response');
  const send = (data: unknown) => listeners.forEach((fn) => fn({ source: win, data }));
  return { win, all, responses, send };
}

test('hook: fetch follow 403 reports error code 161 and only rate-limit headers', async () => {
  const body = JSON.stringify({ errors: [{ code: 161, message: 'You are unable to follow more people at this time.' }], user: { id: 1 } });
  const { win, responses } = loadHook(async () => new Response(body, {
    status: 403,
    headers: { 'x-rate-limit-remaining': '12', 'x-csrf-token': 'SECRET', 'content-type': 'application/json' },
  }));
  const res = await win.fetch('/i/api/1.1/friendships/create.json', { method: 'POST' });
  assert.equal(await res.text(), body, 'page still receives the untouched body');
  await settle();
  assert.equal(responses().length, 1);
  const { msg, origin } = responses()[0]!;
  assert.equal(origin, 'https://x.com');
  assert.equal(msg.channel, 'chan');
  assert.deepEqual(JSON.parse(JSON.stringify(msg.data)), {
    method: 'POST',
    path: '/i/api/1.1/friendships/create.json',
    status: 403,
    headers: { 'x-rate-limit-remaining': '12' },
    errors: [{ code: 161, message: 'You are unable to follow more people at this time.' }],
  });
});

test('hook: XHR responses are reported; non-API URLs are ignored', async () => {
  const { win, responses } = loadHook(async () => new Response(''));
  const xhr = new win.XMLHttpRequest();
  xhr.open('POST', 'https://x.com/i/api/graphql/zzz/CreateTweet');
  xhr.send();
  Object.assign(xhr, {
    status: 200,
    responseText: JSON.stringify({ errors: [{ code: 344, message: 'daily limit' }] }),
    getAllResponseHeaders: () => 'x-rate-limit-limit: 300\r\nset-cookie: a=b\r\n',
  });
  xhr.listeners.loadend!();
  assert.equal(responses().length, 1);
  const data = responses()[0]!.msg.data;
  assert.equal(data.path, '/i/api/graphql/zzz/CreateTweet');
  assert.deepEqual({ ...data.headers }, { 'x-rate-limit-limit': '300' });
  assert.equal(data.errors[0].code, 344);

  await win.fetch('https://x.com/home');
  await win.fetch('https://api.example.com/i/api/thing');
  const other = new win.XMLHttpRequest();
  other.open('GET', '/sw.js');
  other.send();
  assert.equal(other.listeners.loadend, undefined);
  await settle();
  assert.equal(responses().length, 1);
});

test('hook: announces readiness and reads bodies of endpoints added via config', async () => {
  const body = JSON.stringify({ errors: [{ code: 88, message: 'Rate limit exceeded' }] });
  const { win, all, responses, send } = loadHook(async () => new Response(body, { status: 200 }));
  assert.equal(all[0]?.msg.type, 'xrl-ready');

  await win.fetch('/i/api/graphql/q/CreateRetweet', { method: 'POST' });
  await settle();
  assert.deepEqual([...responses()[0]!.msg.data.errors], [], 'not tracked yet: 200 body not read');

  send({ channel: 'chan', type: 'xrl-config', tracked: [{ method: 'POST', op: 'CreateRetweet' }] });
  await win.fetch('/i/api/graphql/q/CreateRetweet', { method: 'POST' });
  await settle();
  assert.equal(responses()[1]!.msg.data.errors[0].code, 88);

  send({ channel: 'wrong', type: 'xrl-config', tracked: [] });
  await win.fetch('/i/api/graphql/q/CreateRetweet', { method: 'POST' });
  await settle();
  assert.equal(responses()[2]!.msg.data.errors[0].code, 88, 'config from another channel is ignored');
});
