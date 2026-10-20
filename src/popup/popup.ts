import { api } from '../lib/api';
import {
  MAX_CUSTOM, METHODS, defForKey, defFromKey, endpointDefs, parseEndpointInput, sanitizeSettings,
} from '../lib/endpoints';
import { DAY_MS, rlActive, summarize, verdict } from '../lib/records';
import type { EndpointSummary } from '../lib/records';
import { STATE_KEYS, normalizeState } from '../lib/state';
import type { ActionFlags, Capabilities, EndpointDef, ResolvedDef, RuntimeMessage, Settings, StoredState } from '../lib/types';

const ORIGINS = { origins: ['https://x.com/*'] };
const VIEWS = ['home', 'endpoints', 'requests', 'settings'] as const;
type View = (typeof VIEWS)[number];

let data: StoredState = normalizeState({});
let caps: Capabilities = { webRequest: false };
let view: View = 'home';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

type Props = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | number | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'checked' || k === 'disabled') (node as unknown as Record<string, boolean>)[k] = true;
    else if (k.startsWith('data-')) node.dataset[k.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

function send(msg: RuntimeMessage): Promise<unknown> {
  return api.runtime.sendMessage(msg);
}

/* ---------- formatting ---------- */

function statusClass(status: number): string {
  return status === 429 ? 'status s429' : `status s${String(status)[0]}`;
}

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function countdown(resetSec: number, now: number): string {
  const s = Math.max(0, Math.round(resetSec - now / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function shortPath(path: string): string {
  const gql = /^\/i\/api\/graphql\/[^/]+\/(.+)$/.exec(path);
  return gql?.[1] ?? path.replace(/^\/i\/api\//, '');
}

function describeDef(d: EndpointDef): string {
  return `${d.method} ${d.op ? `GraphQL ${d.op}` : shortPath(d.path ?? '')}`;
}

function statusList(statuses: Record<string, number>): string {
  return Object.entries(statuses).map(([code, n]) => `${code}×${n}`).join(', ');
}

/* ---------- settings ---------- */

function defs(): ResolvedDef[] {
  return endpointDefs(data.settings);
}

function saveSettings(patch: Partial<Settings>): void {
  data.settings = sanitizeSettings({ ...data.settings, ...patch });
  render();
  void send({ type: 'settings', patch });
}

function setAction(id: string, flags: Partial<ActionFlags>): void {
  const current = defs().find((d) => d.id === id) ?? { track: true, home: true };
  const next: ActionFlags = { track: current.track, home: current.home, ...flags };
  saveSettings({ actions: { ...data.settings.actions, [id]: next } });
}

/* ---------- navigation ---------- */

function show(next: string): void {
  view = (VIEWS as readonly string[]).includes(next) ? (next as View) : 'home';
  for (const m of document.querySelectorAll<HTMLElement>('main[data-view]')) m.hidden = m.dataset.view !== view;
  history.replaceState(null, '', view === 'home' ? location.pathname : `#${view}`);
  window.scrollTo(0, 0);
  render();
}

/* ---------- home ---------- */

function renderCards(summary: Record<string, EndpointSummary>, homeDefs: ResolvedDef[], now: number): void {
  const cards = $('cards');
  cards.replaceChildren();
  for (const d of homeDefs) {
    const s = summary[d.id];
    if (!s) continue;
    const rl = s.rl;
    const active = rlActive(rl, now);
    const hit = s.lastSignal && now - s.lastSignal.ts < DAY_MS ? s.lastSignal : null;

    cards.append(el('div', { class: `card${hit ? ' hit' : ''}`, title: describeDef(d) },
      el('div', { class: 'card-head' },
        el('span', { class: 'card-label' }, d.label),
        s.last ? el('span', { class: statusClass(s.last.status), title: `Last response ${time(s.last.ts)}` }, s.last.status) : null),
      active
        ? el('div', { class: 'big' }, rl.remaining ?? '?', el('span', { class: 'of' }, ` / ${rl.limit ?? '?'}`))
        : el('div', { class: 'big' }, '—'),
      el('div', { class: 'line' }, active
        ? `resets in ${countdown(rl.reset, now)}`
        : rl ? 'window expired' : 'no rate-limit headers seen'),
      el('div', { class: 'line' }, `24h: ${s.total24h} sent · ${s.ok24h} ok`),
      hit
        ? el('div', { class: 'signal' }, hit.kind === 'http429'
          ? `HTTP 429 · ${ago(hit.ts, now)}`
          : `${hit.label} (HTTP ${hit.status}) · ${ago(hit.ts, now)}`)
        : null,
    ));
  }
  $('cards-empty').hidden = homeDefs.length > 0;
}

function renderTestOptions(tracked: ResolvedDef[]): void {
  const select = $<HTMLSelectElement>('test-endpoint');
  const prev = select.value || 'follow';
  const key = tracked.map((d) => `${d.id}=${d.label}`).join('|');
  if (select.dataset.key !== key) {
    select.replaceChildren(...tracked.map((d) => el('option', { value: d.id }, d.label)));
    select.dataset.key = key;
  }
  if (tracked.some((d) => d.id === prev)) select.value = prev;
  $('test').hidden = tracked.length === 0;
}

function renderVerdict(summary: Record<string, EndpointSummary>, now: number): void {
  const id = $<HTMLSelectElement>('test-endpoint').value;
  const s = summary[id];
  if (!s) return;
  const v = verdict(s);
  const head = $('verdict');
  const detail = $('verdict-detail');
  const name = s.label.toLowerCase();
  head.className = 'verdict';

  switch (v.state) {
    case 'none':
      head.textContent = `No ${name} requests captured yet.`;
      detail.textContent = `Use ${s.label} on x.com with this extension enabled. Each response's status, headers and error codes are recorded.`;
      break;
    case 'http429': {
      head.classList.add('yes');
      head.textContent = `Yes: X returned HTTP 429 for ${name} ${v.count} time${v.count === 1 ? '' : 's'}.`;
      const last = data.watched.findLast((r) => r.endpoint === id && r.status === 429);
      const h = last ? Object.entries(last.headers).map(([k, val]) => `${k}: ${val}`).join(' · ') : '';
      detail.textContent = `Last at ${last ? time(last.ts) : '?'}. ${h || 'No rate-limit headers on the 429 response.'}`;
      break;
    }
    case 'otherSignal':
      head.classList.add('other');
      head.textContent = `Limited, but not with a 429: HTTP ${v.signal.status}${v.signal.code != null ? ` + error ${v.signal.code}` : ''}.`;
      detail.textContent = `${v.signal.label}, ${ago(v.signal.ts, now)}. Statuses seen: ${statusList(s.statuses)}.`;
      break;
    case 'clean':
      head.textContent = 'No limit response observed yet.';
      detail.textContent = `Statuses seen: ${statusList(v.statuses)}.` +
        (s.rl ? ` Latest headers: ${s.rl.remaining}/${s.rl.limit} left.` : ' This endpoint has not sent x-rate-limit headers.');
      break;
  }
}

function renderSource(): void {
  const parts: string[] = [];
  if (caps.webRequest) parts.push('headers');
  if (data.settings.inspectPage) parts.push('page');
  $('source').textContent = parts.length ? `via ${parts.join(' + ')}` : 'inactive';
}

function renderHome(now: number): void {
  const all = defs();
  const summary = summarize(data.watched, now, all);
  renderSource();
  renderCards(summary, all.filter((d) => d.home), now);
  renderTestOptions(all.filter((d) => d.track));
  renderVerdict(summary, now);
  $('endpoints-count').textContent = String(Object.keys(data.limits).length || '');
  $('requests-count').textContent = String((data.watched.length + data.recent.length) || '');
}

/* ---------- endpoints ---------- */

function renderEndpoints(now: number): void {
  const all = defs();
  const q = $<HTMLInputElement>('endpoint-filter').value.trim().toLowerCase();
  const ratio = (r: { remaining: number | null; limit: number | null }) => (r.remaining ?? 0) / (r.limit || 1);
  const rows = Object.entries(data.limits)
    .map(([key, v]) => ({ key, ...v, active: (v.reset ?? 0) * 1000 > now }))
    .filter((r) => !q || r.key.toLowerCase().includes(q))
    .sort((a, b) => (Number(b.active) - Number(a.active)) || (ratio(a) - ratio(b)) || (b.ts - a.ts));

  const body = $('limits');
  body.replaceChildren();
  for (const r of rows) {
    const [method, path = ''] = r.key.split(' ');
    const cls = !r.active ? 'num muted' : r.remaining === 0 ? 'num zero' : ratio(r) <= 0.2 ? 'num low' : 'num';
    const def = defForKey(r.key, all);
    body.append(el('tr', null,
      el('td', { title: r.key }, `${method} ${shortPath(path.replace('/*/', '/x/'))}`),
      el('td', { class: cls }, r.active ? `${r.remaining}/${r.limit}` : `—/${r.limit}`),
      r.active && r.reset != null
        ? el('td', { class: 'num muted', 'data-reset': r.reset }, countdown(r.reset, now))
        : el('td', { class: 'num muted', 'data-ago': r.ts }, ago(r.ts, now)),
      el('td', { class: 'end' }, def?.track
        ? el('span', { class: 'tag', title: `Tracked as “${def.label}”` }, 'Tracked')
        : el('button', { type: 'button', class: 'small', 'data-track': r.key, title: 'Track this endpoint as an action' }, 'Track')),
    ));
  }
  const empty = $('limits-empty');
  empty.hidden = rows.length > 0;
  empty.textContent = q && Object.keys(data.limits).length
    ? 'No endpoints match the filter.'
    : data.settings.recordOther
      ? 'Nothing yet. Browse x.com to collect rate-limit headers.'
      : 'Recording of other API calls is off. Turn it on in Settings to fill this list.';
}

function trackKey(key: string): void {
  const existing = defForKey(key, defs());
  if (existing) return setAction(existing.id, { track: true, home: true });
  const def = defFromKey(key);
  if (def) saveSettings({ custom: [...data.settings.custom, def] });
}

/* ---------- requests ---------- */

function renderRequests(): void {
  const filter = $<HTMLSelectElement>('request-filter').value;
  const labels = new Map(defs().map((d) => [d.id, d.label]));
  const log = $('log');
  log.replaceChildren();
  let rows = filter === 'tracked' ? [...data.watched] : [...data.watched, ...data.recent];
  if (filter === 'errors') rows = rows.filter((r) => r.status >= 400 || r.signal);
  rows.sort((a, b) => b.ts - a.ts);
  for (const r of rows.slice(0, 300)) {
    const rl = r.rl?.remaining != null ? `${r.rl.remaining}/${r.rl.limit}` : '';
    const err = r.errors.length ? ` err ${r.errors.map((e) => e.code).join(',')}` : '';
    const label = r.endpoint ? labels.get(r.endpoint) : undefined;
    log.append(el('li', { class: r.endpoint ? 'watched' : '', title: `${r.method} ${r.path}\nsources: ${r.sources.join(', ')}` },
      el('span', { class: 'muted' }, time(r.ts)),
      el('span', { class: statusClass(r.status) }, r.status),
      el('span', { class: 'path' }, `${label ? `${label} · ` : ''}${r.method} ${shortPath(r.path)}`),
      el('span', { class: 'muted' }, rl + err),
    ));
  }
  if (!rows.length) log.append(el('li', { class: 'empty' }, 'No requests captured yet.'));
}

/* ---------- settings view ---------- */

function renderSettings(): void {
  const body = $('action-rows');
  body.replaceChildren();
  for (const d of defs()) {
    body.append(el('tr', null,
      el('td', { title: describeDef(d) }, d.label, el('span', { class: 'sub' }, describeDef(d))),
      el('td', { class: 'center' },
        el('input', { type: 'checkbox', checked: d.track, 'data-id': d.id, 'data-field': 'track', 'aria-label': `Track ${d.label}` })),
      el('td', { class: 'center' },
        el('input', { type: 'checkbox', checked: d.home, disabled: !d.track, 'data-id': d.id, 'data-field': 'home', 'aria-label': `Show ${d.label} on home` })),
      el('td', { class: 'end' }, d.builtin
        ? null
        : el('button', { type: 'button', class: 'remove', 'data-remove': d.id, 'aria-label': `Remove ${d.label}`, title: 'Remove' }, '×')),
    ));
  }
  $<HTMLInputElement>('record-other').checked = data.settings.recordOther;
  $<HTMLInputElement>('inspect').checked = data.settings.inspectPage;
}

function addAction(e: SubmitEvent): void {
  e.preventDefault();
  const error = $('add-error');
  const fail = (text: string) => { error.textContent = text; error.hidden = false; };
  error.hidden = true;

  const def = parseEndpointInput(
    $<HTMLSelectElement>('add-method').value,
    $<HTMLInputElement>('add-target').value,
    $<HTMLInputElement>('add-label').value,
  );
  if (!def) return fail('Enter a GraphQL operation name (like CreateRetweet) or a path starting with /i/api/.');

  const all = defs();
  const existing = all.find((d) => d.id === def.id) ??
    all.find((d) => d.method === def.method && (def.op ? d.op === def.op : d.path === def.path));
  if (existing?.track) return fail(`Already tracked as “${existing.label}”.`);
  if (existing) {
    setAction(existing.id, { track: true, home: true });
  } else if (data.settings.custom.length >= MAX_CUSTOM) {
    return fail(`You can add up to ${MAX_CUSTOM} custom actions.`);
  } else {
    saveSettings({ custom: [...data.settings.custom, def] });
  }
  $<HTMLFormElement>('add-form').reset();
}

/* ---------- render loop ---------- */

function render(): void {
  const now = Date.now();
  if (view === 'home') renderHome(now);
  else if (view === 'endpoints') renderEndpoints(now);
  else if (view === 'requests') renderRequests();
  else renderSettings();
}

// Countdowns update in place so lists don't rebuild under the pointer.
function tick(): void {
  const now = Date.now();
  if (view === 'home') return renderHome(now);
  const scope = `main[data-view="${view}"]`;
  for (const n of document.querySelectorAll<HTMLElement>(`${scope} [data-reset]`)) {
    n.textContent = countdown(Number(n.dataset.reset), now);
  }
  for (const n of document.querySelectorAll<HTMLElement>(`${scope} [data-ago]`)) {
    n.textContent = ago(Number(n.dataset.ago), now);
  }
}

async function load(): Promise<void> {
  data = normalizeState(await api.storage.local.get([...STATE_KEYS]));
  render();
}

async function checkPermission(): Promise<void> {
  if (!api.permissions?.contains) return;
  try {
    $('permission').hidden = await api.permissions.contains(ORIGINS);
  } catch { /* Safari may not implement contains for host permissions */ }
}

function init(): void {
  document.addEventListener('click', (e) => {
    const go = (e.target as Element).closest<HTMLElement>('[data-go]');
    if (go?.dataset.go) show(go.dataset.go);
  });

  $('test-endpoint').addEventListener('change', render);
  $('endpoint-filter').addEventListener('input', render);
  $('request-filter').addEventListener('change', render);

  $('limits').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-track]');
    if (b?.dataset.track) trackKey(b.dataset.track);
  });

  const rows = $('action-rows');
  rows.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.id) return;
    setAction(t.dataset.id, t.dataset.field === 'track' ? { track: t.checked, home: t.checked } : { home: t.checked });
  });
  rows.addEventListener('click', (e) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (!id) return;
    const { [id]: _removed, ...actions } = data.settings.actions;
    saveSettings({ custom: data.settings.custom.filter((c) => c.id !== id), actions });
  });

  // `selected` (not .value) so form.reset() returns to POST.
  $('add-method').replaceChildren(...METHODS.map((m) => el('option', { value: m, selected: m === 'POST' }, m)));
  $<HTMLFormElement>('add-form').addEventListener('submit', addAction);

  $<HTMLInputElement>('record-other').addEventListener('change', (e) => saveSettings({ recordOther: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('inspect').addEventListener('change', (e) => saveSettings({ inspectPage: (e.target as HTMLInputElement).checked }));

  $('grant').addEventListener('click', async () => {
    try { await api.permissions.request(ORIGINS); } catch { /* ignore */ }
    void checkPermission();
  });

  $('clear').addEventListener('click', async () => {
    if (!confirm('Delete all captured requests? Settings are kept.')) return;
    await send({ type: 'clear' });
  });

  $('export').addEventListener('click', () => {
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2);
    const a = el('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: `x-ratelimit-${Date.now()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const next = normalizeState({
      ...data,
      ...Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.newValue])),
    });
    data = next;
    // Don't rebuild the settings form while the user is using it.
    if (view !== 'settings' || changes.settings) render();
  });

  send({ type: 'capabilities' }).then((c) => {
    if (c) caps = c as Capabilities;
    if (view === 'home') renderSource();
  }, () => {});

  setInterval(tick, 1000);
  void checkPermission();
  show(location.hash.slice(1));
  void load();
}

init();
