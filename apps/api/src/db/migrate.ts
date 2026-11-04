import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', 'db', 'migrations');

/**
 * Forward-only migration runner. Applied migrations are immutable: a checksum mismatch aborts.
 * A session advisory lock prevents two deploys migrating concurrently.
 */
export async function migrate(databaseUrl: string, dir = MIGRATIONS_DIR, log: (m: string) => void = () => undefined) {
  const c = new Client({ connectionString: databaseUrl });
  await c.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727274)');
    await c.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const applied = new Map((await c.query('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]));
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    let count = 0;
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prev = applied.get(f);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migration ${f} was modified after being applied. Add a new migration instead.`);
        continue;
      }
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1,$2)', [f, checksum]);
        await c.query('COMMIT');
        log(`applied ${f}`);
        count++;
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
    return count;
  } finally {
    await c.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    await c.end();
  }
}
