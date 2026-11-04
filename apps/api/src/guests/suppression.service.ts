import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, Q } from '../common/db.service';
import { ApiError, notFound, unprocessable } from '../common/errors';
import { hmacHex } from '../common/crypto';
import { isValidEmail, maskEmail, maskPhone, normalizePhone } from '../common/phone';
import { AuditService } from '../audit/audit.service';
import { CONFIG, Config } from '../config/config';
import type { RequestCtx } from '../common/request';

export type Channel = 'whatsapp' | 'sms' | 'email';
export const CHANNELS = ['whatsapp', 'sms', 'email'] as const;

export const addSuppressionSchema = z.object({
  channel: z.enum(CHANNELS),
  contact: z.string().trim().min(3).max(254),
  reason: z.enum(['opted_out', 'organizer_added', 'bounce', 'complaint']).default('organizer_added'),
});
export const liftSuppressionSchema = z.object({ liftReason: z.string().trim().min(3).max(300) });

/** Opt-out / suppression list. Contacts are stored as keyed hashes + a masked display value; never linked to guest rows. */
@Injectable()
export class SuppressionService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  normalize(channel: Channel, value: string | null | undefined): string | null {
    if (!value) return null;
    return channel === 'email' ? (isValidEmail(value.toLowerCase()) ? value.toLowerCase() : null) : normalizePhone(value);
  }
  hashContact(workspaceId: string, channel: Channel, normalized: string): string {
    return hmacHex(this.cfg.SUPPRESSION_HASH_SECRET ?? this.cfg.PSEUDONYM_SECRET, `suppress:${workspaceId}:${channel}:${normalized}`);
  }
  mask(channel: Channel, normalized: string) {
    return (channel === 'email' ? maskEmail(normalized) : maskPhone(normalized)) ?? '•••';
  }

  async isSuppressed(q: Q, workspaceId: string, channel: Channel, contact: string | null | undefined): Promise<boolean> {
    const n = this.normalize(channel, contact);
    if (!n) return false;
    const r = await q.one(
      `SELECT 1 FROM communication_suppressions WHERE workspace_id=$1 AND channel=$2 AND contact_hash=$3 AND lifted_at IS NULL`,
      [workspaceId, channel, this.hashContact(workspaceId, channel, n)],
    );
    return !!r;
  }

  /** Records an opt-out. Idempotent: an already-active suppression is left as is. */
  async record(
    q: Q,
    workspaceId: string,
    o: {
      channel: Channel;
      contact: string;
      reason: 'opted_out' | 'organizer_added' | 'bounce' | 'complaint';
      source: 'guest_reply' | 'provider_webhook' | 'organizer' | 'system';
      guestId?: string | null;
      createdBy?: string | null;
    },
  ) {
    const n = this.normalize(o.channel, o.contact);
    if (!n) throw unprocessable('INVALID_CONTACT', 'Enter a valid phone number or email address for this channel');
    const row = await q.one<{ id: string }>(
      `INSERT INTO communication_suppressions (workspace_id, channel, contact_hash, contact_masked, reason, source, guest_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
      [
        workspaceId,
        o.channel,
        this.hashContact(workspaceId, o.channel, n),
        this.mask(o.channel, n),
        o.reason,
        o.source,
        o.guestId ?? null,
        o.createdBy ?? null,
      ],
    );
    return { id: row?.id ?? null, created: !!row };
  }

  async list(ctx: RequestCtx, includeLifted: boolean) {
    const rows = await this.db.query<any>(
      `SELECT id, channel, contact_masked, reason, source, created_at, lifted_at FROM communication_suppressions WHERE workspace_id=$1 AND ($2::boolean OR lifted_at IS NULL) ORDER BY created_at DESC LIMIT 500`,
      [ctx.workspace!.id, includeLifted],
    );
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      contact: r.contact_masked,
      reason: r.reason,
      source: r.source,
      createdAt: r.created_at,
      liftedAt: r.lifted_at,
    }));
  }

  async add(ctx: RequestCtx, input: z.infer<typeof addSuppressionSchema>) {
    return this.db.tx(async (q) => {
      const r = await this.record(q, ctx.workspace!.id, {
        channel: input.channel,
        contact: input.contact,
        reason: input.reason,
        source: 'organizer',
        createdBy: ctx.user!.id,
      });
      await this.cancelPendingFor(q, ctx.workspace!.id, input.channel, input.contact);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'suppression.added',
        resourceType: 'suppression',
        resourceId: r.id,
        metadata: { channel: input.channel, reason: input.reason },
      });
      return { id: r.id, alreadySuppressed: !r.created };
    });
  }

  /** Lifting needs a written reason and is audited; the original opt-out record is kept. */
  async lift(ctx: RequestCtx, id: string, reason: string) {
    return this.db.tx(async (q) => {
      const r = await q.one(
        `UPDATE communication_suppressions SET lifted_at=now(), lifted_by=$3, lift_reason=$4 WHERE id=$1 AND workspace_id=$2 AND lifted_at IS NULL RETURNING id`,
        [id, ctx.workspace!.id, ctx.user!.id, reason],
      );
      if (!r) throw notFound('Suppression');
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'suppression.lifted',
        resourceType: 'suppression',
        resourceId: id,
        reason,
      });
      return { id, lifted: true };
    });
  }

  /** Cancels not-yet-sent messages to a contact that just opted out. */
  async cancelPendingFor(q: Q, workspaceId: string, channel: Channel, contact: string) {
    const n = this.normalize(channel, contact);
    if (!n) return 0;
    const col = channel === 'email' ? 'g.email' : 'g.phone_e164';
    const rows = await q.query(
      `UPDATE scheduled_messages m SET status='cancelled', skip_reason='opted_out', locked_until=NULL, updated_at=now()
        FROM event_invitations i JOIN guests g ON g.id=i.guest_id
        WHERE m.invitation_id=i.id AND m.workspace_id=$1 AND m.channel=$2 AND ${col}=$3 AND m.status IN ('scheduled','queued') RETURNING m.id`,
      [workspaceId, channel, n],
    );
    return rows.length;
  }
}
export { ApiError };
