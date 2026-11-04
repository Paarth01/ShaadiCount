import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { DbService, Q } from '../common/db.service';
import { CONFIG, Config } from '../config/config';
import { redact } from '../common/logger';
import type { RequestCtx } from '../common/request';

export interface AuditEntry {
  workspaceId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  actorType?: 'user' | 'guest' | 'system' | 'provider';
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly db: DbService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  /** Append an audit record. Metadata is passed through the redactor so tokens/contacts never land here. */
  async log(q: Q | null, ctx: Pick<RequestCtx, 'requestId' | 'user'> | null, e: AuditEntry): Promise<void> {
    await (q ?? this.db).query(
      `INSERT INTO audit_logs (workspace_id, actor_user_id, actor_type, request_id, action, resource_type, resource_id, reason, metadata_redacted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        e.workspaceId ?? null,
        e.actorUserId ?? ctx?.user?.id ?? null,
        e.actorType ?? (ctx?.user ? 'user' : 'system'),
        ctx?.requestId ?? null,
        e.action,
        e.resourceType,
        e.resourceId ?? null,
        e.reason ?? null,
        JSON.stringify(redact(e.metadata ?? {})),
      ],
    );
  }

  /** Security events (denied cross-tenant / permission attempts) never include the denied resource's data. */
  async security(ctx: RequestCtx, action: string, meta: Record<string, unknown> = {}, workspaceId?: string | null) {
    try {
      await this.log(null, ctx, {
        workspaceId: workspaceId ?? null,
        action: `security.${action}`,
        resourceType: 'request',
        metadata: meta,
      });
    } catch {
      /* never let audit failure mask the denial */
    }
  }

  async list(workspaceId: string, opts: { limit: number; before?: string; action?: string }) {
    const params: unknown[] = [workspaceId];
    let where = 'a.workspace_id = $1';
    if (opts.before) {
      params.push(opts.before);
      where += ` AND a.created_at < $${params.length}`;
    }
    if (opts.action) {
      params.push(opts.action + '%');
      where += ` AND a.action LIKE $${params.length}`;
    }
    params.push(opts.limit);
    return this.db.query(
      `SELECT a.id, a.action, a.resource_type AS "resourceType", a.resource_id AS "resourceId", a.reason, a.actor_type AS "actorType",
              a.actor_user_id AS "actorUserId", u.display_name AS "actorName", a.metadata_redacted AS metadata, a.created_at AS "createdAt"
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length}`,
      params,
    );
  }
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: DbService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}
  private pseudo(id?: string | null) {
    return id ? createHmac('sha256', this.cfg.PSEUDONYM_SECRET).update(id).digest('hex').slice(0, 20) : null;
  }
  /** Aggregate, pseudonymous product events only: no names, phones, tokens or free text. */
  async track(q: Q | null, name: string, o: { workspaceId?: string; eventId?: string; props?: Record<string, number | string | boolean> }) {
    try {
      await (q ?? this.db).query(`INSERT INTO analytics_events (workspace_pseudo, event_pseudo, name, properties) VALUES ($1,$2,$3,$4)`, [
        this.pseudo(o.workspaceId),
        this.pseudo(o.eventId),
        name,
        JSON.stringify(o.props ?? {}),
      ]);
    } catch {
      /* analytics must never break a request */
    }
  }
}
