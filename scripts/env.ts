// Loads the repository's .env (see .env.example) into process.env.
// Variables already set in the environment win, so inline ones like
// `TARGET=chrome npm run build` and CI settings aren't overridden.
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadEnv(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  config({ path: join(root, '.env'), quiet: true });
}
