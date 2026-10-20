export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Matches either an exact REST path or a GraphQL operation name. */
export interface Matcher {
  method: string;
  path?: string;
  op?: string;
}

export interface EndpointDef extends Matcher {
  id: string;
  label: string;
}

/** A definition with the user's flags applied. */
export interface ResolvedDef extends EndpointDef {
  builtin: boolean;
  track: boolean;
  home: boolean;
}

export interface ActionFlags {
  track: boolean;
  home: boolean;
}

export interface Settings {
  /** Read X error codes from the page hook. */
  inspectPage: boolean;
  /** Keep non-tracked API calls (Endpoints page, full request log). */
  recordOther: boolean;
  /** Per-action flags; a missing entry means tracked and on home. */
  actions: Record<string, ActionFlags>;
  /** User-added definitions. */
  custom: EndpointDef[];
}

/** From x-rate-limit-* headers; reset is epoch seconds, as X sends it. */
export interface RateLimit {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

export interface XError {
  code: number | null;
  message: string;
}

export interface Signal {
  kind: 'http429' | 'errorCode';
  code: number | null;
  label: string;
}

export type Source = 'webRequest' | 'page';

export interface CapturedRecord {
  ts: number;
  method: string;
  host: string;
  path: string;
  status: number;
  /** Id of the tracked definition this request matched, if any. */
  endpoint: string | null;
  headers: Record<string, string>;
  rl: RateLimit | null;
  errors: XError[];
  signal: Signal | null;
  sources: Source[];
}

export interface LimitEntry extends RateLimit {
  ts: number;
  status: number;
}

export interface StoredState {
  watched: CapturedRecord[];
  recent: CapturedRecord[];
  limits: Record<string, LimitEntry>;
  settings: Settings;
}

/** What the page hook reports for one response. Untrusted until validated. */
export interface PageResponse {
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  errors: unknown[];
}

export type RuntimeMessage =
  | { type: 'page-response'; data: PageResponse }
  | { type: 'clear' }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'capabilities' };

export interface Capabilities {
  webRequest: boolean;
}

/** window.postMessage traffic between hook.ts and content.ts. */
export type HookMessage =
  | { channel: string; type: 'xrl-ready' }
  | { channel: string; type: 'xrl-response'; data: PageResponse }
  | { channel: string; type: 'xrl-config'; tracked: Matcher[] };
