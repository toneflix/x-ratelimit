import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS, classify, defForKey, defFromKey, endpointDefs, parseEndpointInput, sanitizeSettings,
} from '../src/lib/endpoints';
import {
  buildRecord, filterHeaders, isRelevantUrl, limitSignal, mergeOrInsert, parseRateLimit, parseUrl, rlActive,
  sanitizeErrors, summarize, verdict,
} from '../src/lib/records';
import type { RecordInput } from '../src/lib/records';
import type { CapturedRecord } from '../src/lib/types';

const DEFS = endpointDefs();

test('classifies the four built-in actions, ignoring GraphQL query-id rotation', () => {
  assert.equal(classify('POST', '/i/api/1.1/friendships/create.json'), 'follow');
  assert.equal(classify('POST', '/i/api/1.1/friendships/destroy.json'), 'unfollow');
  assert.equal(classify('POST', '/i/api/graphql/wR5Z_lEibLvkew3tF9w-Sg/CreateTweet'), 'tweet');
  assert.equal(classify('post', '/i/api/graphql/lI07N6Otwv1PhnEgXILM7A/FavoriteTweet'), 'like');
  assert.equal(classify('POST', '/i/api/graphql/SomeNewHash123/FavoriteTweet'), 'like');
  assert.equal(classify('GET', '/i/api/1.1/friendships/create.json'), null);
  assert.equal(classify('POST', '/i/api/graphql/abc/UnfavoriteTweet'), null);
});

test('only x.com /i/api/ URLs are relevant, and query strings are dropped', () => {
  assert.ok(isRelevantUrl('https://x.com/i/api/1.1/friendships/create.json'));
  assert.ok(!isRelevantUrl('https://x.com/home'));
  assert.ok(!isRelevantUrl('https://evil.com/i/api/x'));
  assert.ok(!isRelevantUrl('http://x.com/i/api/x'));
  assert.deepEqual(parseUrl('https://x.com/i/api/graphql/h/UserByScreenName?variables=%7B%7D'),
    { host: 'x.com', path: '/i/api/graphql/h/UserByScreenName' });
});

test('keeps rate-limit headers and drops anything credential-like', () => {
  const h = filterHeaders([
    { name: 'X-Rate-Limit-Limit', value: '50' },
    { name: 'x-rate-limit-remaining', value: '3' },
    { name: 'x-rate-limit-reset', value: '1760950000' },
    { name: 'Retry-After', value: '60' },
    { name: 'set-cookie', value: 'auth_token=secret' },
    { name: 'x-csrf-token', value: 'secret' },
    { name: 'x-auth-limit', value: 'secret' },
    { name: 'content-type', value: 'application/json' },
  ]);
  assert.deepEqual(h, {
    'x-rate-limit-limit': '50',
    'x-rate-limit-remaining': '3',
    'x-rate-limit-reset': '1760950000',
    'retry-after': '60',
  });
  assert.deepEqual(parseRateLimit(h), { limit: 50, remaining: 3, reset: 1760950000 });
  assert.equal(parseRateLimit({}), null);
  assert.deepEqual(filterHeaders(null), {});
  assert.deepEqual(filterHeaders({ 'x-rate-limit-limit': 5, cookie: 'x' }), { 'x-rate-limit-limit': '5' });
});

test('limit signals: HTTP 429, or a limit error code on any status', () => {
  assert.equal(limitSignal(429, [])?.kind, 'http429');
  assert.deepEqual(limitSignal(403, [{ code: 161, message: 'x' }]),
    { kind: 'errorCode', code: 161, label: 'Follow limit reached' });
  assert.equal(limitSignal(200, [{ code: 344, message: '' }])?.code, 344);
  assert.equal(limitSignal(403, [{ code: 139, message: 'already favorited' }]), null);
  assert.equal(limitSignal(200, []), null);
});

test('sanitizeErrors keeps only code and a truncated message', () => {
  const out = sanitizeErrors([
    { code: '161', message: 'You are unable to follow more people at this time.', extra: { token: 'x' } },
    { message: 'graphql', extensions: { code: 88 } },
    { message: 'y'.repeat(500) },
    'junk',
  ]);
  assert.deepEqual(out[0], { code: 161, message: 'You are unable to follow more people at this time.' });
  assert.equal(out[1]?.code, 88);
  assert.equal(out[2]?.message.length, 200);
  assert.equal(out.length, 3);
  assert.deepEqual(sanitizeErrors('nope'), []);
});

function rec(over: Partial<RecordInput> = {}): CapturedRecord {
  return buildRecord({
    ts: 1000, method: 'POST', host: 'x.com', path: '/i/api/1.1/friendships/create.json',
    status: 200, headers: {}, errors: [], source: 'webRequest', ...over,
  });
}

test('webRequest and page records for the same response merge into one', () => {
  const list: CapturedRecord[] = [];
  mergeOrInsert(list, rec({ status: 403, headers: { 'x-rate-limit-remaining': '0' } }), 10);
  mergeOrInsert(list, rec({ ts: 1200, status: 403, errors: [{ code: 161 }], source: 'page' }), 10);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0]?.sources, ['webRequest', 'page']);
  assert.equal(list[0]?.rl?.remaining, 0);
  assert.equal(list[0]?.signal?.code, 161);

  // A second click is a separate request even within the window.
  mergeOrInsert(list, rec({ ts: 1300, status: 403 }), 10);
  assert.equal(list.length, 2);
  // Too far apart: not merged.
  mergeOrInsert(list, rec({ ts: 9000, status: 403, source: 'page' }), 10);
  assert.equal(list.length, 3);
});

test('history is capped', () => {
  const list: CapturedRecord[] = [];
  for (let i = 0; i < 15; i++) mergeOrInsert(list, rec({ ts: i * 10000 }), 10);
  assert.equal(list.length, 10);
  assert.equal(list[0]?.ts, 50000);
});

test('summary and verdict answer whether follow produced a 429', () => {
  const now = 100 * 1000;
  const ok = [rec({ ts: 1000 }), rec({ ts: 2000 })];
  let s = summarize(ok, now, DEFS);
  assert.equal(s.follow?.total24h, 2);
  assert.equal(s.follow?.ok24h, 2);
  assert.equal(verdict(s.follow).state, 'clean');
  assert.equal(verdict(s.like).state, 'none');

  s = summarize([...ok, rec({ ts: 3000, status: 403, errors: [{ code: 161 }] })], now, DEFS);
  assert.equal(verdict(s.follow).state, 'otherSignal');
  assert.equal(s.follow?.lastSignal?.status, 403);

  s = summarize([...ok, rec({
    ts: 4000, status: 429,
    headers: { 'x-rate-limit-remaining': '0', 'x-rate-limit-limit': '50', 'x-rate-limit-reset': '200' },
  })], now, DEFS);
  assert.deepEqual(verdict(s.follow), { state: 'http429', count: 1 });
  assert.equal(s.follow?.rl?.remaining, 0);
  assert.ok(rlActive(s.follow?.rl, now));
});

test('settings: untracked actions are not classified, custom ones are', () => {
  const settings = sanitizeSettings({
    actions: { like: { track: false }, bogus: { track: false } },
    custom: [{ method: 'POST', op: 'CreateRetweet', label: 'Repost' }, { method: 'POST', op: 'bad op' }],
  });
  assert.deepEqual(Object.keys(settings.actions), ['like']);
  assert.equal(settings.custom.length, 1);
  const defs = endpointDefs(settings);
  assert.equal(classify('POST', '/i/api/graphql/h/FavoriteTweet', defs), null);
  assert.equal(classify('POST', '/i/api/graphql/h/CreateRetweet', defs), 'custom:POST:op:CreateRetweet');
  assert.equal(defs.find((d) => d.id === 'like')?.home, false, 'untracked implies not on home');
  assert.equal(defs.find((d) => d.id === 'follow')?.home, true);
});

test('settings: sanitize drops duplicates, junk and unknown fields', () => {
  const s = sanitizeSettings({
    inspectPage: false, extra: 1,
    custom: [
      { method: 'POST', op: 'A' }, { method: 'POST', op: 'A' },
      { method: 'TRACE', op: 'B' }, { method: 'GET', path: '/etc/passwd' }, 'nope',
    ],
  });
  assert.equal(s.inspectPage, false);
  assert.equal(s.recordOther, true);
  assert.equal((s as unknown as Record<string, unknown>).extra, undefined);
  assert.deepEqual(s.custom.map((c) => c.id), ['custom:POST:op:A']);
  assert.deepEqual(sanitizeSettings(), DEFAULT_SETTINGS);
});

test('parseEndpointInput accepts URLs, paths and GraphQL names', () => {
  assert.equal(parseEndpointInput('post', 'CreateRetweet')?.op, 'CreateRetweet');
  assert.equal(parseEndpointInput('POST', 'https://x.com/i/api/graphql/abc/DeleteTweet?x=1')?.op, 'DeleteTweet');
  assert.equal(parseEndpointInput('POST', '/i/api/graphql/DeleteTweet')?.op, 'DeleteTweet');
  assert.deepEqual(parseEndpointInput('POST', '/i/api/1.1/dm/new2.json?x=y', ' DMs '),
    { method: 'POST', path: '/i/api/1.1/dm/new2.json', id: 'custom:POST:/i/api/1.1/dm/new2.json', label: 'DMs' });
  assert.equal(parseEndpointInput('POST', '/home'), null);
  assert.equal(parseEndpointInput('POST', ''), null);
});

test('endpoints-table keys map to definitions', () => {
  assert.equal(defForKey('POST /i/api/graphql/*/CreateTweet', DEFS)?.id, 'tweet');
  assert.equal(defForKey('POST /i/api/1.1/friendships/create.json', DEFS)?.id, 'follow');
  assert.equal(defForKey('GET /i/api/graphql/*/HomeTimeline', DEFS), null);
  assert.equal(defFromKey('GET /i/api/graphql/*/HomeTimeline')?.op, 'HomeTimeline');
  assert.equal(defFromKey('GET /i/api/2/notifications/all.json')?.path, '/i/api/2/notifications/all.json');
});
