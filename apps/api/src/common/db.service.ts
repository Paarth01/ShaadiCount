import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { CONFIG, Config } from '../config/config';

// bigint -> number (paise amounts are far below 2^53), numeric -> number, date -> 'YYYY-MM-DD' string.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(1082, (v) => v);

/** Minimal query interface shared by the pool and by transaction clients. */
export interface Q {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
}

class TxClient implements Q {
  constructor(private readonly c: PoolClient) {}
  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.c.query(sql, params as any[])).rows as T[];
  }
  async one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
}

@Injectable()
export class DbService implements Q, OnModuleDestroy {
  readonly pool: Pool;
  constructor(@Inject(CONFIG) cfg: Config) {
    this.pool = new Pool({
      connectionString: cfg.DATABASE_URL,
      max: 10,
      statement_timeout: 20_000,
      // Fail fast instead of hanging forever when the pool is exhausted or the database is unreachable.
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      idle_in_transaction_session_timeout: 30_000,
    });
    // Without a listener, an error on an idle pooled client (database restart, failover, network reset) is an
    // unhandled 'error' event and crashes the whole process. Log it; pg discards the broken client by itself.
    this.pool.on('error', (err) => {
      process.stderr.write(
        JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'pg_pool_idle_client_error', errorMessage: err.message }) +
          '\n',
      );
    });
  }
  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(sql, params as any[])).rows as T[];
  }
  async one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  /** Runs fn inside a transaction; commits on success and rolls back on any throw. */
  async tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const out = await fn(new TxClient(client));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      // If even ROLLBACK fails the connection is unusable: tell the pool to destroy it instead of reusing it.
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      throw e;
    } finally {
      client.release(broken);
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}

export const isUniqueViolation = (e: any, constraintHint?: string) =>
  e?.code === '23505' && (!constraintHint || String(e.constraint ?? '').includes(constraintHint));
export const isFkViolation = (e: any) => e?.code === '23503';
export const isCheckViolation = (e: any) => e?.code === '23514';
