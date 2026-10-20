/*
 * Page-world hook. Wraps fetch and XMLHttpRequest to observe responses from
 * x.com/i/api/*. It never touches requests, and reports only: method, path
 * (no query string), status, rate-limit headers and, for tracked actions or
 * any error status, the `errors[].code/message` from the JSON body.
 * Everything is re-filtered in the background.
 *
 * Runs in the page's JS world, so it must not import anything that touches
 * extension APIs (lib/api.ts).
 */
import { BUILTIN, isObject, matches } from './lib/endpoints';
import { keepHeader } from './lib/records';
import type { HookMessage, Matcher } from './lib/types';

(() => {
  const channel = (document.currentScript as HTMLScriptElement | null)?.dataset.channel ?? '';
  const FLAG = Symbol.for('x-ratelimit-hooked');
  const win = window as unknown as Record<symbol, unknown>;
  if (!channel || win[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true });

  // Tracked endpoints whose bodies are checked for error codes even on 2xx
  // (X reports some limits as 200 + error). Starts with the built-ins and is
  // replaced by content.ts with the user's tracked list.
  let tracked: Matcher[] = BUILTIN.map(({ method, path, op }) => ({ method, path, op }));

  function target(url: string | URL): string | null {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin && u.pathname.startsWith('/i/api/') ? u.pathname : null;
    } catch {
      return null;
    }
  }

  function wantsBody(method: string, path: string, status: number): boolean {
    const m = method.toUpperCase();
    return status >= 400 || tracked.some((d) => matches(d, m, path));
  }

  function extractErrors(body: unknown): unknown[] {
    try {
      const json: unknown = typeof body === 'string' ? JSON.parse(body) : body;
      if (!isObject(json) || !Array.isArray(json.errors)) return [];
      return json.errors.slice(0, 5).map((e: unknown) => {
        if (!isObject(e)) return {};
        const ext = isObject(e.extensions) ? e.extensions : {};
        return {
          code: e.code ?? ext.code,
          message: typeof e.message === 'string' ? e.message.slice(0, 200) : '',
        };
      });
    } catch {
      return [];
    }
  }

  function post(msg: HookMessage): void {
    window.postMessage(msg, location.origin);
  }

  function report(method: string, path: string, status: number, headers: Record<string, string>, errors: unknown[]): void {
    post({ channel, type: 'xrl-response', data: { method: method.toUpperCase(), path, status, headers, errors } });
  }

  window.addEventListener('message', (e: MessageEvent<unknown>) => {
    const d = e.data;
    if (e.source !== window || !isObject(d) || d.channel !== channel || d.type !== 'xrl-config') return;
    if (Array.isArray(d.tracked)) {
      tracked = d.tracked.filter((t: unknown): t is Matcher => isObject(t) && typeof t.method === 'string' &&
        (typeof t.path === 'string' || typeof t.op === 'string'));
    }
  });
  post({ channel, type: 'xrl-ready' });

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const promise = origFetch.call(this, input, init);
      try {
        const isReq = typeof Request !== 'undefined' && input instanceof Request;
        const path = target(isReq ? input.url : String(input));
        if (path) {
          const method = init?.method ?? (isReq ? input.method : 'GET');
          promise.then((res) => {
            const headers: Record<string, string> = {};
            res.headers.forEach((v, k) => { if (keepHeader(k)) headers[k] = v; });
            if (!wantsBody(method, path, res.status)) return report(method, path, res.status, headers, []);
            res.clone().text().then(
              (t) => report(method, path, res.status, headers, extractErrors(t)),
              () => report(method, path, res.status, headers, []),
            );
          }, () => {});
        }
      } catch { /* never break the page */ }
      return promise;
    };
  }

  const meta = new WeakMap<XMLHttpRequest, { method: string; path: string }>();
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open as (this: XMLHttpRequest, ...args: unknown[]) => void;
  const origSend = XHR.send;

  XHR.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
    try {
      const path = target(url);
      if (path) meta.set(this, { method, path });
      else meta.delete(this);
    } catch { /* ignore */ }
    origOpen.call(this, method, url, ...rest);
  } as typeof XHR.open;

  XHR.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    const m = meta.get(this);
    if (m) {
      this.addEventListener('loadend', () => {
        try {
          if (!this.status) return;
          const headers: Record<string, string> = {};
          for (const line of this.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
            const i = line.indexOf(':');
            if (i <= 0) continue;
            const k = line.slice(0, i).trim().toLowerCase();
            if (keepHeader(k)) headers[k] = line.slice(i + 1).trim();
          }
          let errors: unknown[] = [];
          if (wantsBody(m.method, m.path, this.status)) {
            if (this.responseType === '' || this.responseType === 'text') errors = extractErrors(this.responseText);
            else if (this.responseType === 'json') errors = extractErrors(this.response);
          }
          report(m.method, m.path, this.status, headers, errors);
        } catch { /* ignore */ }
      });
    }
    origSend.call(this, body);
  };
})();
