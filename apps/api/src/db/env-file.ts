import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Loads KEY=VALUE pairs from the repo-root .env (if present) without overriding real environment variables. */
export function loadEnvFile(path = join(__dirname, '..', '..', '..', '..', '.env')) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
