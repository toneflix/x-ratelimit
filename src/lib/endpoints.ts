import type { EndpointDef, Matcher, Method, ResolvedDef, Settings } from './types';

export const MAX_CUSTOM = 30;
export const METHODS: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// GraphQL query IDs (the hash segment) rotate when X ships a new client, so
// those are matched by operation name, not by full path:
//   POST /i/api/graphql/wR5Z_lEibLvkew3tF9w-Sg/CreateTweet  ->  op CreateTweet
export const BUILTIN: readonly EndpointDef[] = [
  { id: 'follow', label: 'Follow', method: 'POST', path: '/i/api/1.1/friendships/create.json' },
  { id: 'unfollow', label: 'Unfollow', method: 'POST', path: '/i/api/1.1/friendships/destroy.json' },
  { id: 'tweet', label: 'Post', method: 'POST', op: 'CreateTweet' },
  { id: 'like', label: 'Like', method: 'POST', op: 'FavoriteTweet' },
];

export const DEFAULT_SETTINGS: Settings = {
  inspectPage: true,
  recordOther: true,
  actions: {},
  custom: [],
};

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isMethod(m: string): m is Method {
  return (METHODS as readonly string[]).includes(m);
}

export function graphqlOp(path: string): string | null {
  return /^\/i\/api\/graphql\/[^/]+\/([^/]+)$/.exec(path)?.[1] ?? null;
}

export function matches(def: Matcher, method: string, path: string): boolean {
  if (def.method !== method) return false;
  if (def.path) return def.path === path;
  return graphqlOp(path) === def.op;
}

/** Validates a user-supplied or stored definition; null if malformed. */
export function makeDef(input: unknown): EndpointDef | null {
  if (!isObject(input)) return null;
  const method = String(input.method ?? '').toUpperCase();
  if (!isMethod(method)) return null;
  const { path, op, label } = input;

  let def: Omit<EndpointDef, 'label'>;
  if (typeof path === 'string' && /^\/i\/api\/[\w.\-/]+$/.test(path) && !path.startsWith('/i/api/graphql/')) {
    def = { method, path, id: `custom:${method}:${path}` };
  } else if (typeof op === 'string' && /^\w{1,80}$/.test(op)) {
    def = { method, op, id: `custom:${method}:op:${op}` };
  } else {
    return null;
  }
  const fallback = def.op ?? (def.path ?? '').split('/').filter(Boolean).slice(-2).join('/');
  const name = typeof label === 'string' && label.trim() ? label.trim() : fallback;
  return { ...def, label: name.slice(0, 24) };
}

/** Accepts a full URL, an /i/api/... path or a bare GraphQL operation name. */
export function parseEndpointInput(method: string, text: string, label?: string): EndpointDef | null {
  let s = text.trim();
  if (!s) return null;
  if (/^https?:/i.test(s)) {
    try { s = new URL(s).pathname; } catch { return null; }
  }
  s = s.split('?')[0] ?? '';
  const gql = /^\/i\/api\/graphql\/(?:[^/]+\/)?([^/]+)$/.exec(s);
  if (gql) return makeDef({ method, op: gql[1], label });
  if (s.startsWith('/i/api/')) return makeDef({ method, path: s, label });
  if (/^\w+$/.test(s)) return makeDef({ method, op: s, label });
  return null;
}

export function sanitizeSettings(input?: unknown): Settings {
  const s = isObject(input) ? input : {};
  const out: Settings = {
    inspectPage: s.inspectPage !== false,
    recordOther: s.recordOther !== false,
    actions: {},
    custom: [],
  };
  const seen = new Set(BUILTIN.map((b) => b.id));
  for (const c of Array.isArray(s.custom) ? s.custom : []) {
    const def = makeDef(c);
    if (!def || seen.has(def.id) || out.custom.length >= MAX_CUSTOM) continue;
    seen.add(def.id);
    out.custom.push(def);
  }
  for (const [id, v] of Object.entries(isObject(s.actions) ? s.actions : {})) {
    if (!seen.has(id) || !isObject(v)) continue;
    out.actions[id] = { track: v.track !== false, home: v.home !== false };
  }
  return out;
}

/** All definitions, built-in first, with the user's flags resolved. */
export function endpointDefs(settings: Settings = DEFAULT_SETTINGS): ResolvedDef[] {
  return [
    ...BUILTIN.map((d) => ({ ...d, builtin: true })),
    ...settings.custom.map((d) => ({ ...d, builtin: false })),
  ].map((d) => {
    const flags = settings.actions[d.id];
    const track = flags?.track !== false;
    return { ...d, track, home: track && flags?.home !== false };
  });
}

/** Id of the first *tracked* definition matching the request. */
export function classify(method: string, path: string, defs: ResolvedDef[] = endpointDefs()): string | null {
  const m = method.toUpperCase();
  return defs.find((d) => d.track && matches(d, m, path))?.id ?? null;
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(' ');
  return [key.slice(0, i), key.slice(i + 1)];
}

/** Finds a definition (tracked or not) for a key like "POST /i/api/graphql/*\/CreateTweet". */
export function defForKey(key: string, defs: ResolvedDef[]): ResolvedDef | null {
  const [method, path] = splitKey(key);
  return defs.find((d) => matches(d, method, path.replace('/graphql/*/', '/graphql/x/'))) ?? null;
}

export function defFromKey(key: string): EndpointDef | null {
  const [method, path] = splitKey(key);
  const gql = /^\/i\/api\/graphql\/\*\/([^/]+)$/.exec(path);
  return gql ? makeDef({ method, op: gql[1] }) : makeDef({ method, path });
}
