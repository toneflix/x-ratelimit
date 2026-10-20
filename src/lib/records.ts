import { classify, isObject } from './endpoints';
import type { CapturedRecord, RateLimit, ResolvedDef, Signal, Source, XError } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_WATCHED = 1000;
export const MAX_RECENT = 300;
const MERGE_WINDOW_MS = 5000;

// X error codes that mean "you hit a limit", which X often returns with a
// status other than 429 (e.g. 403 + 161 for follows, 200 + 344 for posts).
export const LIMIT_ERROR_CODES: Readonly<Record<number, string>> = {
  88: 'Rate limit exceeded',
  161: 'Follow limit reached',
  185: 'Daily post limit reached',
  226: 'Request looked automated',
  326: 'Account temporarily locked',
  344: 'Daily limit reached',
};

const HEADER_ALLOW = /(rate|limit|retry)/i;
// Never keep anything that could carry credentials, even if it also
// matches the allow pattern.
const HEADER_DENY = /(cookie|auth|token|csrf|session|bearer|guest|password|secret)/i;

export function keepHeader(name: string): boolean {
  return HEADER_ALLOW.test(name) && !HEADER_DENY.test(name);
}

export function isRelevantUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'x.com' && u.pathname.startsWith('/i/api/');
  } catch {
    return false;
  }
}

/** Query strings on X API calls contain user IDs and cursors; drop them. */
export function parseUrl(url: string): { host: string; path: string } {
  const u = new URL(url);
  return { host: u.hostname, path: u.pathname };
}

export function normalizePath(path: string): string {
  return path.replace(/^\/i\/api\/graphql\/[^/]+\//, '/i/api/graphql/*/');
}

/** Accepts webRequest's [{name, value}], [[name, value]] or {name: value}. */
export function filterHeaders(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(input)) return out;
  const pairs: unknown[][] = Array.isArray(input)
    ? input.map((h: unknown) => (Array.isArray(h) ? h : isObject(h) ? [h.name, h.value] : []))
    : Object.entries(input);
  for (const [rawName, rawValue] of pairs) {
    if (typeof rawName !== 'string' || rawValue == null) continue;
    const name = rawName.toLowerCase().trim();
    if (!keepHeader(name)) continue;
    out[name] = String(rawValue).slice(0, 200);
  }
  return out;
}

function toInt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function readTriple(headers: Record<string, string>, prefix: string): RateLimit | null {
  const limit = toInt(headers[`${prefix}limit`]);
  const remaining = toInt(headers[`${prefix}remaining`]);
  const reset = toInt(headers[`${prefix}reset`]);
  if (limit == null && remaining == null && reset == null) return null;
  return { limit, remaining, reset };
}

export function parseRateLimit(headers: Record<string, string>): RateLimit | null {
  return readTriple(headers, 'x-rate-limit-') ?? readTriple(headers, 'x-ratelimit-');
}

/** Keeps only code and a truncated message from X's `errors` array. */
export function sanitizeErrors(errors: unknown): XError[] {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 5).map((e: unknown): XError => {
    if (!isObject(e)) return { code: null, message: '' };
    const ext = isObject(e.extensions) ? e.extensions : {};
    return {
      code: toInt(e.code ?? ext.code),
      message: typeof e.message === 'string' ? e.message.slice(0, 200) : '',
    };
  }).filter((e) => e.code != null || e.message);
}

export function limitSignal(status: number, errors: XError[]): Signal | null {
  if (status === 429) return { kind: 'http429', code: null, label: 'HTTP 429' };
  for (const e of errors) {
    const label = e.code != null ? LIMIT_ERROR_CODES[e.code] : undefined;
    if (label) return { kind: 'errorCode', code: e.code, label };
  }
  return null;
}

export interface RecordInput {
  ts: number;
  method: string;
  host: string;
  path: string;
  status: number;
  headers: unknown;
  errors: unknown;
  source: Source;
}

export function buildRecord(input: RecordInput, defs?: ResolvedDef[]): CapturedRecord {
  const method = input.method.toUpperCase();
  const headers = filterHeaders(input.headers);
  const errors = sanitizeErrors(input.errors);
  return {
    ts: input.ts,
    method,
    host: input.host,
    path: input.path,
    status: input.status,
    endpoint: classify(method, input.path, defs),
    headers,
    rl: parseRateLimit(headers),
    errors,
    signal: limitSignal(input.status, errors),
    sources: [input.source],
  };
}

/**
 * webRequest and the page hook both see the same response. Whichever arrives
 * second is folded into the first so each request counts once.
 */
export function mergeOrInsert(list: CapturedRecord[], rec: CapturedRecord, max: number): CapturedRecord {
  const source = rec.sources[0];
  for (let i = list.length - 1, seen = 0; i >= 0 && seen < 50; i--, seen++) {
    const r = list[i]!;
    if (
      r.method === rec.method &&
      r.path === rec.path &&
      r.status === rec.status &&
      source && !r.sources.includes(source) &&
      Math.abs(r.ts - rec.ts) <= MERGE_WINDOW_MS
    ) {
      r.sources = [...r.sources, source];
      r.headers = { ...rec.headers, ...r.headers };
      r.rl = r.rl ?? rec.rl;
      if (!r.errors.length && rec.errors.length) r.errors = rec.errors;
      r.signal = r.signal ?? rec.signal;
      return r;
    }
  }
  list.push(rec);
  if (list.length > max) list.splice(0, list.length - max);
  return rec;
}

export type ActiveRateLimit = RateLimit & { reset: number };

export function rlActive(rl: RateLimit | null | undefined, now: number): rl is ActiveRateLimit {
  return !!rl && rl.reset != null && rl.reset * 1000 > now;
}

export type LastSignal = Signal & { ts: number; status: number };

export interface EndpointSummary {
  id: string;
  label: string;
  statuses: Record<string, number>;
  total24h: number;
  ok24h: number;
  last: CapturedRecord | null;
  rl: RateLimit | null;
  rlTs: number;
  http429: number;
  signalCount: number;
  lastSignal: LastSignal | null;
}

export function summarize(
  records: readonly CapturedRecord[],
  now: number,
  defs: readonly { id: string; label: string }[],
): Record<string, EndpointSummary> {
  const out: Record<string, EndpointSummary> = {};
  for (const d of defs) {
    out[d.id] = {
      id: d.id, label: d.label, statuses: {}, total24h: 0, ok24h: 0,
      last: null, rl: null, rlTs: 0, http429: 0, signalCount: 0, lastSignal: null,
    };
  }
  for (const r of records) {
    const s = r.endpoint ? out[r.endpoint] : undefined;
    if (!s) continue;
    s.statuses[r.status] = (s.statuses[r.status] ?? 0) + 1;
    if (now - r.ts < DAY_MS) {
      s.total24h++;
      if (r.status >= 200 && r.status < 300 && !r.signal) s.ok24h++;
    }
    if (!s.last || r.ts >= s.last.ts) s.last = r;
    if (r.rl && r.ts >= s.rlTs) { s.rl = r.rl; s.rlTs = r.ts; }
    if (r.status === 429) s.http429++;
    if (r.signal) {
      s.signalCount++;
      if (!s.lastSignal || r.ts >= s.lastSignal.ts) s.lastSignal = { ...r.signal, ts: r.ts, status: r.status };
    }
  }
  return out;
}

export type Verdict =
  | { state: 'none' }
  | { state: 'http429'; count: number }
  | { state: 'otherSignal'; signal: LastSignal }
  | { state: 'clean'; statuses: Record<string, number> };

/** Answers "does this action produce a detectable 429?" from what was seen. */
export function verdict(summary: EndpointSummary | undefined): Verdict {
  if (!summary || !Object.keys(summary.statuses).length) return { state: 'none' };
  if (summary.http429) return { state: 'http429', count: summary.http429 };
  if (summary.lastSignal) return { state: 'otherSignal', signal: summary.lastSignal };
  return { state: 'clean', statuses: summary.statuses };
}
