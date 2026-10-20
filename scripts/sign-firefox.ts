// Builds the Firefox package and source archive, then submits both to
// addons.mozilla.org for listed review with web-ext.
// Needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET (from
// https://addons.mozilla.org/developers/addon/api/key/).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './targets';

if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET to your AMO API credentials.');
}

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env });

run('npx', ['tsx', 'scripts/zip-source.ts']);
run('npx', ['tsdown', '--config-loader', 'tsx'], { ...process.env, TARGET: 'firefox' });

const { version } = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')) as { version: string };
run('npx', [
  '--yes', 'web-ext@10.8.0', 'sign',
  '--source-dir', 'dist/firefox',
  '--artifacts-dir', 'dist/web-ext-artifacts',
  '--channel', 'listed',
  '--amo-metadata', 'store/amo-metadata.json',
  '--upload-source-code', `dist/rate-limit-tracker-for-x-source-${version}.zip`,
  // Listed versions wait for review; don't block on it.
  '--approval-timeout', '0',
]);
