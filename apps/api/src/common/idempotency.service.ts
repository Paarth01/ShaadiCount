import { Injectable } from '@nestjs/common';
import { DbService, Q } from './db.service';
import { ApiError, badRequest, conflict } from './errors';
import { sha256Hex } from './crypto';

const KEY_RE = /^[A-Za-z0-9_\-:.]{16,128}$/;

function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return (
      '{' +
      Object.keys(v as object)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((v as any)[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(v ?? null);
}

export interface IdemResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Idempotency for retried mutations. The key record is inserted in the SAME transaction as the business write,
 * so a failed attempt rolls the key back (retry allowed) and concurrent duplicates serialise on the unique index.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly db: DbService) {}

  static validateKey(key: string | undefined, required: boolean): string | undefined {
    if (!key) {
      if (required) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (16-128 chars) is required for this operation');
      return undefined;
    }
    if (!KEY_RE.test(key)) throw badRequest('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 16-128 characters of [A-Za-z0-9_-:.]');
    return key;
  }

  async run<T>(
    o: { scope: string; operation: string; key: string | undefined; required?: boolean; request: unknown },
    fn: (q: Q) => Promise<{ status: number; body: T }>,
  ): Promise<IdemResult<T>> {
    const key = IdempotencyService.validateKey(o.key, !!o.required);
    if (!key) {
      const r = await this.db.tx(fn);
      return { ...r, replayed: false };
    }
    const hash = sha256Hex(canonical(o.request));
    return this.db.tx(async (q) => {
      const ins = await q.one<{ id: string }>(
        `INSERT INTO idempotency_records (scope_key, operation, idempotency_key, request_hash, expires_at)
         VALUES ($1,$2,$3,$4, now() + interval '48 hours') ON CONFLICT DO NOTHING RETURNING id`,
        [o.scope, o.operation, key, hash],
      );
      if (!ins) {
        const ex = await q.one<{ request_hash: string; response_status: number | null; response_body: T }>(
          `SELECT request_hash, response_status, response_body FROM idempotency_records WHERE scope_key=$1 AND operation=$2 AND idempotency_key=$3`,
          [o.scope, o.operation, key],
        );
        if (!ex) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Please retry the request');
        if (ex.request_hash !== hash)
          throw conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
        if (ex.response_status === null) throw conflict('IDEMPOTENCY_IN_PROGRESS', 'The original request is still being processed');
        return { status: ex.response_status, body: ex.response_body, replayed: true };
      }
      const out = await fn(q);
      await q.query(`UPDATE idempotency_records SET response_status=$2, response_body=$3 WHERE id=$1`, [
        ins.id,
        out.status,
        JSON.stringify(out.body),
      ]);
      return { ...out, replayed: false };
    });
  }
}
