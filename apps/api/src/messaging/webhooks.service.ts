import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { DbService, Q } from '../common/db.service';
import { ApiError, notFound, unprocessable } from '../common/errors';
import { hmacHex, safeEqual } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { CONFIG, Config } from '../config/config';
import { SuppressionService } from '../guests/suppression.service';
import type { RequestCtx } from '../common/request';

export const webhookEventSchema = z.object({
  eventId: z.string().min(8).max(100),
  type: z.enum(['submitted', 'delivered', 'read', 'failed', 'opted_out']),
  providerMessageId: z.string().min(3).max(200),
  occurredAt: z.string().datetime().optional(),
  errorCode: z.string().max(60).optional(),
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

const RANK: Record<string, number> = { scheduled: 0, queued: 1, unknown: 1, submitted: 2, delivered: 3, read: 4 };
const TERMINAL = new Set(['failed', 'cancelled', 'skipped']);

/**
 * Monotonic status machine for provider callbacks (webhooks may arrive late, twice, or out of order):
 * delivery states only move forward; a terminal state is never overwritten; a failure cannot follow delivery.
 */
export function nextStatus(current: string, type: WebhookEvent['type']): string | null {
  if (type === 'opted_out' || TERMINAL.has(current)) return null;
  if (type === 'failed') return ['delivered', 'read'].includes(current) ? null : 'failed';
  const target = type; // submitted | delivered | read
  return (RANK[target] ?? -1) > (RANK[current] ?? 99) ? target : null;
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly db: DbService,
    private readonly limiter: RateLimitService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly suppression: SuppressionService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  /** Header format: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, 5-minute replay window. */
  verify(raw: Buffer | undefined, header: string | undefined, nowMs = Date.now()): boolean {
    const secret = this.cfg.MESSAGING_WEBHOOK_SECRET;
    if (!secret || !raw || !header) return false;
    const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > 300 || !parts.v1) return false;
    return safeEqual(hmacHex(secret, `${parts.t}.${raw.toString('utf8')}`), parts.v1);
  }

  async ingest(ctx: RequestCtx, provider: string, raw: Buffer | undefined, header: string | undefined) {
    this.limiter.hit(`webhook:${ctx.ip}`, this.cfg.RATE_LIMIT_WEBHOOK_PER_MIN);
    if (!this.cfg.MESSAGING_WEBHOOK_SECRET) throw new ApiError(503, 'WEBHOOKS_DISABLED', 'Webhook receiving is not configured');
    if (!['fake', 'live'].includes(provider) || (provider === 'live' && this.cfg.MESSAGING_MODE !== 'live')) throw notFound('Provider');
    if (!this.verify(raw, header)) {
      await this.audit.security(ctx, 'webhook_signature_invalid', { provider });
      throw new ApiError(401, 'INVALID_SIGNATURE', 'Signature verification failed');
    }
    let parsed;
    try {
      parsed = webhookEventSchema.safeParse(JSON.parse(raw!.toString('utf8')));
    } catch {
      throw unprocessable('INVALID_PAYLOAD', 'Body is not valid JSON');
    }
    if (!parsed.success)
      throw unprocessable(
        'INVALID_PAYLOAD',
        'Webhook payload failed validation',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    return this.apply(provider, parsed.data);
  }

  /** Sandbox: route a simulated provider event through exactly the same dedupe + transition logic as a real callback. */
  applySimulated(_ctx: RequestCtx, provider: string, e: { type: WebhookEvent['type']; providerMessageId: string }) {
    return this.apply(provider, { eventId: `sim_${randomUUID()}`, ...e });
  }

  async apply(provider: string, ev: WebhookEvent) {
    return this.db.tx(async (q) => {
      const ins = await q.one<{ id: string }>(
        `INSERT INTO provider_webhook_events (provider, provider_event_id, payload_redacted) VALUES ($1,$2,$3) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
        [
          provider,
          ev.eventId,
          JSON.stringify({
            type: ev.type,
            providerMessageId: ev.providerMessageId,
            occurredAt: ev.occurredAt ?? null,
            errorCode: ev.errorCode ?? null,
          }),
        ],
      );
      if (!ins) return { result: 'duplicate' as const };
      const m = await q.one<any>(`SELECT * FROM scheduled_messages WHERE provider=$1 AND provider_message_id=$2 FOR UPDATE`, [
        provider,
        ev.providerMessageId,
      ]);
      if (!m) {
        await q.query(`UPDATE provider_webhook_events SET processing_status='unmatched', processed_at=now() WHERE id=$1`, [ins.id]);
        return { result: 'unmatched' as const };
      }
      if (ev.type === 'opted_out') {
        await this.handleOptOut(q, m);
        await q.query(`UPDATE provider_webhook_events SET workspace_id=$2, processing_status='processed', processed_at=now() WHERE id=$1`, [
          ins.id,
          m.workspace_id,
        ]);
        return { result: 'opted_out' as const };
      }
      const to = nextStatus(m.status, ev.type);
      if (!to) {
        await q.query(`UPDATE provider_webhook_events SET workspace_id=$2, processing_status='ignored', processed_at=now() WHERE id=$1`, [
          ins.id,
          m.workspace_id,
        ]);
        return { result: 'ignored' as const, status: m.status };
      }
      await q.query(
        `UPDATE scheduled_messages SET status=$2, last_error_code=COALESCE($3,last_error_code), locked_until=NULL, updated_at=now() WHERE id=$1`,
        [m.id, to, ev.type === 'failed' ? (ev.errorCode ?? 'PROVIDER_FAILED') : null],
      );
      await q.query(
        `INSERT INTO message_status_history (workspace_id,scheduled_message_id,from_status,to_status,source,provider_event_id) VALUES ($1,$2,$3,$4,'webhook',$5)`,
        [m.workspace_id, m.id, m.status, to, ev.eventId],
      );
      await q.query(`UPDATE provider_webhook_events SET workspace_id=$2, processing_status='processed', processed_at=now() WHERE id=$1`, [
        ins.id,
        m.workspace_id,
      ]);
      await this.analytics.track(q, 'message_status_changed', { workspaceId: m.workspace_id, props: { to } });
      return { result: 'applied' as const, status: to };
    });
  }

  /** A provider-reported opt-out suppresses the contact, revokes consent evidence and cancels pending messages. */
  private async handleOptOut(q: Q, m: any) {
    const g = await q.one<any>(
      `SELECT g.id, g.event_id, g.phone_e164, g.email FROM event_invitations i JOIN guests g ON g.id=i.guest_id WHERE i.id=$1`,
      [m.invitation_id],
    );
    if (!g) return;
    const contact = m.channel === 'email' ? g.email : g.phone_e164;
    if (!contact) return;
    await this.suppression.record(q, m.workspace_id, {
      channel: m.channel,
      contact,
      reason: 'opted_out',
      source: 'provider_webhook',
      guestId: g.id,
    });
    await q.query(
      `INSERT INTO communication_consents (workspace_id,event_id,guest_id,channel,status,basis,evidence_note) VALUES ($1,$2,$3,$4,'revoked','guest_opt_in','Opt-out received from messaging provider')`,
      [m.workspace_id, g.event_id, g.id, m.channel],
    );
    await this.suppression.cancelPendingFor(q, m.workspace_id, m.channel, contact);
    await this.audit.log(q, null, {
      workspaceId: m.workspace_id,
      actorType: 'provider',
      action: 'guest.opted_out',
      resourceType: 'guest',
      resourceId: g.id,
      metadata: { channel: m.channel },
    });
  }
}
