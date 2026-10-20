// Per-browser build targets: rolldown target, manifest tweaks and the
// static files (manifest, icons) that go alongside the bundles.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIcon } from './icons';

type Manifest = Record<string, unknown>;

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const src = join(root, 'src');

export interface Target {
  /** Rolldown/oxc syntax target. */
  syntax: string;
  manifest: (m: Manifest) => Manifest;
}

export const TARGETS: Record<string, Target> = {
  chrome: {
    syntax: 'chrome111',
    manifest: (m) => ({ ...m, background: { service_worker: 'background.js' }, minimum_chrome_version: '111' }),
  },
  // Firefox MV3 uses an event page. Host permissions are opt-in, so the popup
  // shows a "Grant x.com access" button until the user approves. Firefox 140
  // (142 on Android) is the first to support data_collection_permissions,
  // which addons.mozilla.org requires.
  firefox: {
    syntax: 'firefox140',
    manifest: (m) => ({
      ...m,
      background: { scripts: ['background.js'] },
      browser_specific_settings: {
        gecko: {
          id: 'x-ratelimit@opensource',
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['none'] },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  },
  // Safari: service worker (works on macOS and iOS). Safari's webRequest
  // doesn't reliably expose response headers to MV3 workers, so data comes
  // mostly from the page hook. Wrap in an Xcode app with `npm run safari`.
  safari: {
    syntax: 'safari16',
    manifest: (m) => ({ ...m, background: { service_worker: 'background.js' } }),
  },
};

/**
 * Each entry becomes one self-contained IIFE: service workers, content
 * scripts and the page hook can't load shared ES module chunks.
 */
export const ENTRIES: Record<string, string> = {
  background: 'src/background.ts',
  content: 'src/content.ts',
  hook: 'src/hook.ts',
  'popup/popup': 'src/popup/popup.ts',
};

export function writeStatic(outDir: string, target: Target): void {
  const base = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')) as Manifest;
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(target.manifest(base), null, 2) + '\n');
  mkdirSync(join(outDir, 'icons'), { recursive: true });
  for (const size of [16, 32, 48]) writeFileSync(join(outDir, 'icons', `icon-${size}.png`), renderIcon(size));
  writeFileSync(join(outDir, 'icons', 'icon-128.png'), renderIcon(128, 16));
}
