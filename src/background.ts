/*
 * Collects X API responses from two sources and persists them:
 *   - webRequest.onHeadersReceived: status + response headers (Chrome, Firefox)
 *   - the page hook via content.ts: status, headers and X error codes
 *     (the main source in Safari, where webRequest may not expose headers)
 * Request headers are never read, and response headers are filtered down to
 * rate-limit ones, so cookies and tokens never reach storage.
 */
import { api } from './lib/api';
import { classify, endpointDefs, isObject, sanitizeSettings } from './lib/endpoints';
import {
  MAX_RECENT, MAX_WATCHED, buildRecord, isRelevantUrl, mergeOrInsert, normalizePath, parseUrl, rlActive, summarize,
} from './lib/records';
import { STATE_KEYS, normalizeState } from './lib/state';
import type { CapturedRecord, Capabilities, PageResponse, StoredState } from './lib/types';

let state: StoredState | null = null;
let chain: Promise<void> = Promise.resolve();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function logError(err: unknown): void {
  console.error('[x-ratelimit]', err);
}

async function flush(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (state) await api.storage.local.set(state);
}

/**
 * Serialises all mutations so concurrent events can't clobber each other.
 * fn returns true to persist immediately (tracked actions, user changes);
 * otherwise the write is batched so background API noise stays cheap.
 */
function mutate(fn: (s: StoredState) => boolean): Promise<void> {
  chain = chain.then(async () => {
    state ??= normalizeState(await api.storage.local.get([...STATE_KEYS]));
    if (fn(state)) {
      await flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => { chain = chain.then(flush).catch(logError); }, 1000);
    }
    updateBadge(state);
  }).catch(logError);
  return chain;
}

// Classified here, against the current settings, rather than when the record
// is built, because settings are only available once state has loaded.
function ingest(rec: CapturedRecord): Promise<void> {
  return mutate((s) => {
    rec.endpoint = classify(rec.method, rec.path, endpointDefs(s.settings));
    if (!rec.endpoint && !s.settings.recordOther) return false;
    const merged = rec.endpoint
      ? mergeOrInsert(s.watched, rec, MAX_WATCHED)
      : mergeOrInsert(s.recent, rec, MAX_RECENT);
    if (merged.rl) {
      s.limits[`${merged.method} ${normalizePath(merged.path)}`] = { ts: merged.ts, status: merged.status, ...merged.rl };
    }
    return !!rec.endpoint;
  });
}

function updateBadge(s: StoredState): void {
  if (!api.action?.setBadgeText) return;
  const now = Date.now();
  const summary = summarize(s.watched, now, endpointDefs(s.settings).filter((d) => d.track));
  let text = '';
  let color = '#536471';
  let minRatio = Infinity;
  for (const e of Object.values(summary)) {
    if (e.lastSignal && now - e.lastSignal.ts < 15 * 60 * 1000) {
      text = '!';
      color = '#f4212e';
      break;
    }
    if (rlActive(e.rl, now) && e.rl.limit && e.rl.remaining != null) {
      const ratio = e.rl.remaining / e.rl.limit;
      if (ratio < minRatio) {
        minRatio = ratio;
        text = String(e.rl.remaining);
        color = ratio <= 0.2 ? '#ffad1f' : '#536471';
      }
    }
  }
  void api.action.setBadgeText({ text });
  void api.action.setBadgeBackgroundColor({ color });
}

if (api.webRequest?.onHeadersReceived) {
  try {
    api.webRequest.onHeadersReceived.addListener(
      (details) => {
        if (details.method === 'OPTIONS' || !isRelevantUrl(details.url)) return undefined;
        const { host, path } = parseUrl(details.url);
        void ingest(buildRecord({
          ts: Date.now(),
          method: details.method,
          host,
          path,
          status: details.statusCode,
          headers: details.responseHeaders,
          errors: [],
          source: 'webRequest',
        }));
        return undefined;
      },
      { urls: ['https://x.com/i/api/*'] },
      ['responseHeaders'],
    );
  } catch (err) {
    logError(err);
  }
}

function isPageResponse(d: unknown): d is PageResponse {
  return isObject(d) &&
    typeof d.method === 'string' &&
    typeof d.path === 'string' && d.path.startsWith('/i/api/') &&
    Number.isInteger(d.status) && (d.status as number) > 0;
}

api.runtime.onMessage.addListener((msg: unknown, sender, sendResponse): boolean => {
  if (!isObject(msg)) return false;

  if (msg.type === 'page-response') {
    // Only accept from our own content script running on x.com.
    if (!sender.tab || !sender.url?.startsWith('https://x.com/')) return false;
    if (!isPageResponse(msg.data)) return false;
    void ingest(buildRecord({
      ts: Date.now(),
      method: msg.data.method,
      host: 'x.com',
      path: msg.data.path,
      status: msg.data.status,
      headers: msg.data.headers,
      errors: msg.data.errors,
      source: 'page',
    }));
    return false;
  }

  // Everything else comes from the popup, which has no sender.tab.
  if (sender.tab) return false;

  if (msg.type === 'clear') {
    void mutate((s) => { s.watched = []; s.recent = []; s.limits = {}; return true; })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'settings' && isObject(msg.patch)) {
    const patch = msg.patch;
    void mutate((s) => {
      s.settings = sanitizeSettings({ ...s.settings, ...patch });
      return true;
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'capabilities') {
    sendResponse({ webRequest: !!api.webRequest?.onHeadersReceived } satisfies Capabilities);
    return false;
  }

  return false;
});

// Restore the badge after the worker/event page restarts.
void mutate(() => false);
