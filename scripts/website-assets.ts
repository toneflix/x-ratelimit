// Renders the website's logo and favicon from the same code as the
// extension icons, so there's one source for the artwork.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderIcon } from './icons';
import { root } from './targets';

const out = join(root, 'website', 'public');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'logo.png'), renderIcon(512));
writeFileSync(join(out, 'favicon.png'), renderIcon(64, 2));
