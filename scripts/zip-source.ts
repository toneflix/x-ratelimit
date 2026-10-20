// Zips the committed source tree for addons.mozilla.org review, which
// requires source for bundled code: dist/rate-limit-tracker-for-x-source-<version>.zip
// Refuses to run with uncommitted changes, so the archive always matches
// the code the submitted package was built from.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './targets';

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

if (git('status', '--porcelain').trim()) {
  throw new Error('Commit or stash your changes first: the source archive is built from HEAD.');
}

const { version } = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')) as { version: string };
mkdirSync(join(root, 'dist'), { recursive: true });
const zip = join(root, 'dist', `rate-limit-tracker-for-x-source-${version}.zip`);
rmSync(zip, { force: true });
git('archive', '--format=zip', `--prefix=x-ratelimit-${version}/`, '-o', zip, 'HEAD');
console.log(`wrote ${zip.slice(root.length + 1)} from ${git('rev-parse', '--short', 'HEAD').trim()}`);
