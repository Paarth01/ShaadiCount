import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, Q } from '../common/db.service';
import { ApiError, notFound, unprocessable } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { CONFIG, Config } from '../config/config';
import { addDays } from '../common/time';
import type { RequestCtx } from '../common/request';

export const dataRequestSchema = z.object({
  type: z.enum(['export', 'deletion']),
  confirmWorkspaceName: z.string().optional(),
});

@Injectable()
export class PrivacyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  list(ctx: RequestCtx) {
    return this.db
      .query(
        `SELECT id, type, status, requested_at AS "requestedAt", execute_after AS "executeAfter", completed_at AS "completedAt", export_job_id AS "exportId"
         FROM data_requests WHERE workspace_id=$1 ORDER BY requested_at DESC LIMIT 50`,
        [ctx.workspace!.id],
      )
      .then((data) => ({ data }));
  }

  async create(ctx: RequestCtx, i: z.infer<typeof dataRequestSchema>) {
    if (i.type === 'export') return this.createExport(ctx);
    // Deletion needs the workspace name typed back, and is executed only after a cancellable grace period.
    if (i.confirmWorkspaceName?.trim() !== ctx.workspace!.name)
      throw unprocessable('CONFIRMATION_MISMATCH', 'Type the exact workspace name to confirm deletion');
    return this.db.tx(async (q) => {
      const pending = await q.one(`SELECT 1 FROM data_requests WHERE workspace_id=$1 AND type='deletion' AND status='scheduled'`, [
        ctx.workspace!.id,
      ]);
      if (pending) throw new ApiError(409, 'DELETION_ALREADY_SCHEDULED', 'A deletion is already scheduled for this workspace');
      const executeAfter = addDays(new Date(), this.cfg.DELETION_GRACE_DAYS);
      const r = await q.one<any>(
        `INSERT INTO data_requests (workspace_id,type,status,requested_by,execute_after) VALUES ($1,'deletion','scheduled',$2,$3) RETURNING id`,
        [ctx.workspace!.id, ctx.user!.id, executeAfter],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'privacy.deletion_scheduled',
        resourceType: 'workspace',
        resourceId: ctx.workspace!.id,
        metadata: { executeAfter: executeAfter.toISOString() },
      });
      return {
        id: r.id,
        type: 'deletion',
        status: 'scheduled',
        executeAfter,
        note: 'Opt-out records and audit logs are retained after deletion. You can cancel until the date shown.',
      };
    });
  }

  async cancel(ctx: RequestCtx, id: string) {
    return this.db.tx(async (q) => {
      const r = await q.one(
        `UPDATE data_requests SET status='cancelled' WHERE id=$1 AND workspace_id=$2 AND type='deletion' AND status='scheduled' RETURNING id`,
        [id, ctx.workspace!.id],
      );
      if (!r) throw notFound('Data request');
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'privacy.deletion_cancelled',
        resourceType: 'workspace',
        resourceId: ctx.workspace!.id,
      });
      return { id, status: 'cancelled' };
    });
  }

  /** Portable JSON of everything the workspace holds about its events and guests. Message bodies and tokens are never included. */
  private async createExport(ctx: RequestCtx) {
    const ws = ctx.workspace!.id;
    const all = async (sql: string) => this.db.query(sql, [ws]);
    const data = {
      generatedAt: new Date().toISOString(),
      workspace: (await all(`SELECT id, name, created_at FROM workspaces WHERE id=$1`))[0],
      members: await all(
        `SELECT u.display_name, m.role, m.created_at FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1`,
      ),
      events: await all(
        `SELECT id, name, timezone, start_date, end_date, host_name, status FROM events WHERE workspace_id=$1 AND deleted_at IS NULL`,
      ),
      functions: await all(
        `SELECT id, event_id, name, starts_at, venue, capacity, rsvp_deadline, status FROM event_functions WHERE workspace_id=$1`,
      ),
      guestGroups: await all(`SELECT id, event_id, label FROM guest_groups WHERE workspace_id=$1 AND deleted_at IS NULL`),
      guests: await all(
        `SELECT id, event_id, guest_group_id, display_name, phone_e164, email, preferred_language, tags FROM guests WHERE workspace_id=$1 AND deleted_at IS NULL`,
      ),
      invitations: await all(
        `SELECT id, event_function_id, guest_id, invited_party_size, status, revoked_at FROM event_invitations WHERE workspace_id=$1`,
      ),
      rsvpResponses: await all(
        `SELECT invitation_id, status, adult_count, child_count, version, responded_at FROM rsvp_responses WHERE workspace_id=$1`,
      ),
      checkIns: await all(
        `SELECT invitation_id, event_function_id, adults_present, children_present, checked_in_at, voided_at FROM check_ins WHERE workspace_id=$1`,
      ),
      consents: await all(
        `SELECT guest_id, channel, status, basis, evidence_note, recorded_at FROM communication_consents WHERE workspace_id=$1`,
      ),
      suppressions: await all(
        `SELECT channel, contact_masked, reason, source, created_at, lifted_at FROM communication_suppressions WHERE workspace_id=$1`,
      ),
      campaigns: await all(
        `SELECT id, event_function_id, name, kind, channel, status, scheduled_at FROM message_campaigns WHERE workspace_id=$1`,
      ),
      messages: await all(
        `SELECT id, campaign_id, invitation_id, channel, status, skip_reason, attempt_count, created_at FROM scheduled_messages WHERE workspace_id=$1`,
      ),
      cateringEstimates: await all(
        `SELECT event_function_id, label, estimated_meals, estimated_cost_paise, created_at FROM catering_estimates WHERE workspace_id=$1`,
      ),
    };
    const content = JSON.stringify(data, null, 2);
    return this.db.tx(async (q) => {
      const job = await q.one<any>(
        `INSERT INTO export_jobs (workspace_id,kind,requested_by,content_type,content,row_count,expires_at) VALUES ($1,'workspace_data',$2,'application/json; charset=utf-8',$3,$4,$5) RETURNING id, expires_at`,
        [ws, ctx.user!.id, content, data.guests.length, addDays(new Date(), this.cfg.EXPORT_RETENTION_DAYS)],
      );
      const r = await q.one<any>(
        `INSERT INTO data_requests (workspace_id,type,status,requested_by,completed_at,export_job_id) VALUES ($1,'export','completed',$2,now(),$3) RETURNING id`,
        [ws, ctx.user!.id, job.id],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ws,
        action: 'privacy.export_created',
        resourceType: 'workspace',
        resourceId: ws,
        metadata: { guests: data.guests.length },
      });
      return {
        id: r.id,
        type: 'export',
        status: 'completed',
        exportId: job.id,
        expiresAt: job.expires_at,
        downloadPath: `/v1/workspaces/${ws}/exports/${job.id}/download`,
      };
    });
  }

  /**
   * Executes deletions whose grace period has elapsed. Personal data is deleted; what is deliberately RETAINED:
   * opt-out/suppression evidence (hashed contact), the append-only audit log, pseudonymous analytics, and the data request itself.
   */
  async executeDueDeletions(now = new Date()): Promise<number> {
    const due = await this.db.query<{ id: string; workspace_id: string }>(
      `SELECT id, workspace_id FROM data_requests WHERE type='deletion' AND status='scheduled' AND execute_after <= $1`,
      [now],
    );
    let n = 0;
    for (const d of due) {
      await this.db.tx(async (q) => {
        const claimed = await q.one(
          `UPDATE data_requests SET status='completed', completed_at=now() WHERE id=$1 AND status='scheduled' RETURNING id`,
          [d.id],
        );
        if (!claimed) return;
        await this.purgeWorkspace(q, d.workspace_id);
        await this.audit.log(q, null, {
          workspaceId: d.workspace_id,
          actorType: 'system',
          action: 'privacy.workspace_deleted',
          resourceType: 'workspace',
          resourceId: d.workspace_id,
          metadata: { requestId: d.id },
        });
      });
      n++;
    }
    return n;
  }

  private async purgeWorkspace(q: Q, ws: string) {
    await q.query(`SET LOCAL app.allow_purge = 'on'`); // permits DELETE on append-only RSVP history (never audit_logs: it has no purge path here)
    const del = (sql: string) => q.query(sql, [ws]);
    await del(`UPDATE data_requests SET export_job_id=NULL WHERE workspace_id=$1`);
    for (const sql of [
      `DELETE FROM check_ins WHERE workspace_id=$1`,
      `DELETE FROM message_status_history WHERE workspace_id=$1`,
      `DELETE FROM message_attempts WHERE workspace_id=$1`,
      `DELETE FROM scheduled_messages WHERE workspace_id=$1`,
      `DELETE FROM message_campaigns WHERE workspace_id=$1`,
      `DELETE FROM rsvp_response_history WHERE workspace_id=$1`,
      `DELETE FROM rsvp_responses WHERE workspace_id=$1`,
      `DELETE FROM event_invitations WHERE workspace_id=$1`,
      `DELETE FROM communication_consents WHERE workspace_id=$1`,
      `DELETE FROM import_jobs WHERE workspace_id=$1`,
      `DELETE FROM export_jobs WHERE workspace_id=$1`,
      `DELETE FROM catering_estimates WHERE workspace_id=$1`,
      `DELETE FROM catering_settings WHERE workspace_id=$1`,
      `DELETE FROM member_assignments WHERE workspace_id=$1`,
      `DELETE FROM guests WHERE workspace_id=$1`,
      `DELETE FROM guest_groups WHERE workspace_id=$1`,
      `DELETE FROM event_functions WHERE workspace_id=$1`,
      `DELETE FROM events WHERE workspace_id=$1`,
      `DELETE FROM fake_provider_messages WHERE workspace_id=$1`,
      `DELETE FROM outbox_events WHERE workspace_id=$1`,
      `DELETE FROM workspace_members WHERE workspace_id=$1`,
    ])
      await del(sql);
    await q.query(`DELETE FROM idempotency_records WHERE scope_key LIKE $1`, [`${ws}|%`]);
    await q.query(`UPDATE workspaces SET deleted_at=now(), name='Deleted workspace' WHERE id=$1`, [ws]);
  }
}

/** Time-based minimisation: expired exports/import files/sandbox bodies/idempotency keys/old sessions. */
@Injectable()
export class RetentionService {
  constructor(private readonly db: DbService) {}
  async runOnce(now = new Date()) {
    const exports = await this.db.query(
      `UPDATE export_jobs SET content=NULL, status='expired' WHERE status='ready' AND expires_at <= $1 RETURNING id`,
      [now],
    );
    const imports = await this.db.query(
      `UPDATE import_jobs SET raw_csv=NULL, status=CASE WHEN status='previewed' THEN 'expired' ELSE status END WHERE raw_csv IS NOT NULL AND expires_at <= $1 RETURNING id`,
      [now],
    );
    const idem = await this.db.query(`DELETE FROM idempotency_records WHERE expires_at <= $1 RETURNING id`, [now]);
    const fake = await this.db.query(
      `UPDATE fake_provider_messages SET body=NULL WHERE body IS NOT NULL AND created_at <= $1::timestamptz - interval '7 days' RETURNING id`,
      [now],
    );
    const sessions = await this.db.query(
      `DELETE FROM sessions WHERE expires_at <= $1::timestamptz - interval '30 days' OR revoked_at <= $1::timestamptz - interval '30 days' RETURNING id`,
      [now],
    );
    return {
      exports: exports.length,
      imports: imports.length,
      idempotencyKeys: idem.length,
      sandboxBodies: fake.length,
      sessions: sessions.length,
    };
  }
}
