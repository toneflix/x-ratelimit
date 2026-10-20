// Zips a built target for store upload: dist/rate-limit-tracker-for-x-<target>-<version>.zip
// Usage: tsx scripts/zip.ts chrome   (run the build first)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './targets';

const target = process.argv[2] ?? 'chrome';
const dir = join(root, 'dist', target);
if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`dist/${target} isn't built`);

const { version } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { version: string };
const zip = join(root, 'dist', `rate-limit-tracker-for-x-${target}-${version}.zip`);
rmSync(zip, { force: true });
// -X drops macOS extended attributes; manifest.json ends up at the zip root.
execFileSync('zip', ['-qrX', zip, '.'], { cwd: dir });
console.log(`wrote ${zip.slice(root.length + 1)}`);
