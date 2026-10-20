// Builds dist/chrome, dist/firefox and dist/safari.
// `tsdown` builds every target; `TARGET=chrome tsdown` builds one.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsdown';
import type { UserConfig } from 'tsdown';
import { loadEnv } from './scripts/env';
import { ENTRIES, TARGETS, root, writeStatic } from './scripts/targets';

loadEnv();

const names = process.env.TARGET ? process.env.TARGET.split(',') : Object.keys(TARGETS);

const configs: UserConfig[] = names.flatMap((name) => {
  const target = TARGETS[name];
  if (!target) throw new Error(`Unknown TARGET: ${name} (expected ${Object.keys(TARGETS).join(', ')})`);
  const outDir = join(root, 'dist', name);
  // Several builds share this folder, so it's cleaned once here rather
  // than by each build's `clean`.
  rmSync(outDir, { recursive: true, force: true });

  return Object.entries(ENTRIES).map(([out, file], i): UserConfig => ({
    entry: { [out]: file },
    format: 'iife',
    platform: 'browser',
    target: target.syntax,
    outDir,
    // The manifest references plain .js names (tsdown would emit .iife.js).
    outputOptions: { entryFileNames: '[name].js' },
    clean: false,
    dts: false,
    logLevel: 'warn',
    // The first build of each target also emits the static files.
    ...(i === 0 && {
      copy: [{ from: ['src/popup/popup.html', 'src/popup/popup.css'], to: join(outDir, 'popup') }],
      hooks: {
        'build:done': () => writeStatic(outDir, target),
      },
    }),
  }));
});

export default defineConfig(configs);
