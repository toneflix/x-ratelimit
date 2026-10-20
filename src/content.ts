/*
 * Runs on x.com at document_start. Injects hook.js into the page so it can
 * observe X's own fetch/XHR responses, then relays what it reports to the
 * background. Injected synchronously so it wraps fetch before X's bundle
 * grabs a reference; the inspectPage setting only gates relaying.
 */
import { api } from './lib/api';
import { endpointDefs, isObject, sanitizeSettings } from './lib/endpoints';
import type { HookMessage, Matcher, RuntimeMessage } from './lib/types';

const channel = crypto.randomUUID();
let enabled = true;
let tracked: Matcher[] | null = null;
let hookReady = false;

function postToHook(msg: HookMessage): void {
  window.postMessage(msg, location.origin);
}

// The hook and the settings load race each other, so the tracked list is
// sent once both are available, and again whenever settings change.
function sendConfig(): void {
  if (hookReady && tracked) postToHook({ channel, type: 'xrl-config', tracked });
}

function applySettings(raw: unknown): void {
  const s = sanitizeSettings(raw);
  enabled = s.inspectPage;
  tracked = endpointDefs(s).filter((d) => d.track).map(({ method, path, op }) => ({ method, path, op }));
  sendConfig();
}

api.storage.local.get('settings').then((s) => applySettings(s.settings), () => applySettings(null));
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) applySettings(changes.settings.newValue);
});

window.addEventListener('message', (e: MessageEvent<unknown>) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data;
  if (!isObject(d) || d.channel !== channel) return;
  if (d.type === 'xrl-ready') {
    hookReady = true;
    sendConfig();
    return;
  }
  if (!enabled || d.type !== 'xrl-response') return;
  try {
    // The background validates the payload; it's page-supplied.
    const msg = { type: 'page-response', data: d.data } as RuntimeMessage;
    api.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // Extension was reloaded; this content script is orphaned.
  }
});

const script = document.createElement('script');
script.src = api.runtime.getURL('hook.js');
script.dataset.channel = channel;
script.async = false;
script.onload = () => script.remove();
(document.head ?? document.documentElement).appendChild(script);
