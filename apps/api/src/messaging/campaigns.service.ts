import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, Q } from '../common/db.service';
import { ApiError, notFound, unprocessable } from '../common/errors';
import { IdempotencyService } from '../common/idempotency.service';
import { OutboxService } from '../common/outbox.service';
import { ScopeService } from '../common/scope.service';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { CONFIG, Config } from '../config/config';
import { maskEmail, maskPhone } from '../common/phone';
import { parseEventTime } from '../common/time';
import { Audience, EligibilityService, contactFor, ExclusionReason } from './eligibility.service';
import { defaultTemplateFor, formatWhen, getTemplate, renderTemplate } from './templates';
import { WebhooksService } from './webhooks.service';
import type { RequestCtx } from '../common/request';

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['invitation', 'reminder']),
  channel: z.enum(['whatsapp', 'sms', 'email']).default('whatsapp'),
  templateKey: z.string().max(60).optional(),
  audience: z.enum(['all_invited', 'not_responded', 'maybe', 'not_yet_messaged']).optional(),
});
export const scheduleSchema = z.object({
  scheduledAt: z.string().min(10).optional(),
  confirmRecipientCount: z.number().int().min(0),
  confirmEstimatedCostPaise: z.number().int().min(0),
});
export const reasonBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const simulateSchema = z.object({ event: z.enum(['delivered', 'read', 'failed', 'opted_out']) });
export const messagesQuery = z.object({
  status: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const PENDING = ['scheduled', 'queued'];

@Injectable()
export class CampaignsService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly elig: EligibilityService,
    private readonly idem: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly webhooks: WebhooksService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private dto(c: any) {
    return {
      id: c.id,
      functionId: c.event_function_id,
      name: c.name,
      kind: c.kind,
      channel: c.channel,
      templateKey: c.template_key,
      templateVersion: c.template_version,
      audience: c.audience,
      status: c.status,
      scheduledAt: c.scheduled_at,
      estimatedRecipients: c.estimated_recipients,
      estimatedCostPaise: c.estimated_cost_paise,
      createdAt: c.created_at,
    };
  }
  private async load(ctx: RequestCtx, eventId: string, functionId: string, campaignId: string, q: Q = this.db, lock = false) {
    const { fn, event } = await this.scope.fn(ctx, eventId, functionId, q);
    const c = await q.one<any>(
      `SELECT * FROM message_campaigns WHERE id=$1 AND event_function_id=$2 AND workspace_id=$3 ${lock ? 'FOR UPDATE' : ''}`,
      [campaignId, functionId, ctx.workspace!.id],
    );
    if (!c) throw notFound('Campaign');
    return { fn, event, c };
  }

  async create(ctx: RequestCtx, eventId: string, functionId: string, i: z.infer<typeof createCampaignSchema>) {
    return this.db.tx(async (q) => {
      await this.scope.fn(ctx, eventId, functionId, q);
      const t = i.templateKey ? getTemplate(i.templateKey) : defaultTemplateFor(i.kind);
      if (!t || t.kind !== i.kind) throw unprocessable('TEMPLATE_UNAVAILABLE', 'Choose a template that matches the campaign type');
      if (!this.cfg.ENABLED_CHANNELS.includes(i.channel)) throw unprocessable('CHANNEL_DISABLED', 'This channel is not enabled');
      const audience = i.audience ?? (i.kind === 'invitation' ? 'not_yet_messaged' : 'not_responded');
      const c = await q.one<any>(
        `INSERT INTO message_campaigns (workspace_id,event_id,event_function_id,name,kind,channel,template_key,template_version,audience,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [ctx.workspace!.id, eventId, functionId, i.name, i.kind, i.channel, t.key, t.version, audience, ctx.user!.id],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'campaign.created',
        resourceType: 'campaign',
        resourceId: c.id,
        metadata: { kind: i.kind, channel: i.channel },
      });
      return this.dto(c);
    });
  }

  async list(ctx: RequestCtx, eventId: string, functionId: string) {
    await this.scope.fn(ctx, eventId, functionId);
    const rows = await this.db.query<any>(
      `SELECT c.*, COALESCE((SELECT json_object_agg(s.status, s.n) FROM (SELECT status, count(*)::int AS n FROM scheduled_messages WHERE campaign_id=c.id GROUP BY status) s), '{}'::json) AS stats
         FROM message_campaigns c WHERE c.event_function_id=$1 AND c.workspace_id=$2 ORDER BY c.created_at DESC`,
      [functionId, ctx.workspace!.id],
    );
    return { data: rows.map((c) => ({ ...this.dto(c), stats: c.stats })) };
  }

  async get(ctx: RequestCtx, eventId: string, functionId: string, campaignId: string) {
    const { c } = await this.load(ctx, eventId, functionId, campaignId);
    const stats = await this.db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM scheduled_messages WHERE campaign_id=$1 GROUP BY status`,
      [campaignId],
    );
    const skips = await this.db.query<{ skip_reason: string; n: number }>(
      `SELECT skip_reason, count(*)::int AS n FROM scheduled_messages WHERE campaign_id=$1 AND skip_reason IS NOT NULL GROUP BY skip_reason`,
      [campaignId],
    );
    return {
      ...this.dto(c),
      stats: Object.fromEntries(stats.map((s) => [s.status, s.n])),
      skipReasons: Object.fromEntries(skips.map((s) => [s.skip_reason, s.n])),
    };
  }

  /** Dry run: who would receive the message, who is excluded and why, what it would cost, and the exact localized text. */
  private async evaluate(ctx: RequestCtx, c: any, functionId: string, q: Q = this.db) {
    const now = new Date();
    const rows = await this.elig.candidates(q, ctx.workspace!.id, functionId, c.channel);
    const suppressed = await this.elig.suppressedContacts(q, ctx.workspace!.id, c.channel, rows);
    const out = rows.map((r) => ({
      r,
      reason: this.elig.reason(r, {
        kind: c.kind,
        channel: c.channel,
        audience: c.audience as Audience,
        now,
        suppressedContacts: suppressed,
      }),
    }));
    const eligible = out.filter((x) => !x.reason);
    const excluded: Record<string, number> = {};
    for (const x of out) if (x.reason) excluded[x.reason] = (excluded[x.reason] ?? 0) + 1;
    const per = this.elig.costPaise(c.channel);
    return { out, eligible, excluded, perMessagePaise: per, totalPaise: per * eligible.length };
  }

  async preview(ctx: RequestCtx, eventId: string, functionId: string, campaignId: string) {
    const { c, event, fn } = await this.load(ctx, eventId, functionId, campaignId);
    const ev = await this.evaluate(ctx, c, functionId);
    const t = getTemplate(c.template_key, c.template_version)!;
    const ws = await this.db.one<{ contact_authority_attested_at: Date | null }>(
      `SELECT contact_authority_attested_at FROM workspaces WHERE id=$1`,
      [ctx.workspace!.id],
    );
    const sample = ev.eligible.slice(0, 3).map(({ r }) => ({
      guestName: r.display_name,
      language: r.preferred_language,
      text: renderTemplate(t, r.preferred_language, {
        guest_name: r.display_name,
        event_name: event.name,
        function_name: fn.name,
        function_datetime: formatWhen(fn.starts_at, event.timezone, r.preferred_language),
        venue: fn.venue ?? (r.preferred_language === 'hi' ? 'स्थान' : 'the venue'),
        rsvp_deadline: formatWhen(fn.rsvp_deadline, event.timezone, r.preferred_language) || 'soon',
        rsvp_link: `${this.cfg.PUBLIC_APP_URL.replace(/\/$/, '')}/r#(personal-link)`,
      }),
    }));
    return {
      campaign: this.dto(c),
      eligibleCount: ev.eligible.length,
      excludedCounts: ev.excluded,
      perMessageEstimatePaise: ev.perMessagePaise,
      estimatedCostPaise: ev.totalPaise,
      costNote: 'Estimate uses placeholder per-message rates from configuration, not verified provider pricing.',
      attestationRequired: !ws?.contact_authority_attested_at,
      sample,
      messagingMode: this.cfg.MESSAGING_MODE,
      recipients: ev.out.slice(0, 300).map(({ r, reason }) => ({
        invitationId: r.invitation_id,
        guestName: r.display_name,
        contact: c.channel === 'email' ? maskEmail(r.email) : maskPhone(r.phone_e164),
        eligible: !reason,
        reason,
      })),
    };
  }

  async schedule(
    ctx: RequestCtx,
    eventId: string,
    functionId: string,
    campaignId: string,
    key: string | undefined,
    i: z.infer<typeof scheduleSchema>,
  ) {
    return this.idem.run(
      { scope: `${ctx.workspace!.id}|${ctx.user!.id}`, operation: `campaign.schedule:${campaignId}`, key, required: true, request: i },
      async (q) => {
        const { c, event } = await this.load(ctx, eventId, functionId, campaignId, q, true);
        if (c.status !== 'draft') throw new ApiError(409, 'CAMPAIGN_NOT_DRAFT', 'Only a draft campaign can be scheduled');
        const ws = await q.one<any>(`SELECT contact_authority_attested_at, message_spend_cap_paise FROM workspaces WHERE id=$1`, [
          ctx.workspace!.id,
        ]);
        if (!ws.contact_authority_attested_at)
          throw unprocessable(
            'ATTESTATION_REQUIRED',
            'Confirm you have authority to contact these guests (Settings > Messaging) before scheduling messages',
          );
        const t = getTemplate(c.template_key, c.template_version);
        if (!t) throw unprocessable('TEMPLATE_UNAVAILABLE', 'This template is no longer available');
        if (this.cfg.MESSAGING_MODE === 'live' && !t.approvedForLive)
          throw unprocessable('TEMPLATE_NOT_APPROVED', 'Template has no verified provider approval for live sending');

        const ev = await this.evaluate(ctx, c, functionId, q);
        if (ev.eligible.length === 0) throw unprocessable('NO_ELIGIBLE_RECIPIENTS', 'No guests are eligible for this campaign', []);
        if (i.confirmRecipientCount !== ev.eligible.length || i.confirmEstimatedCostPaise !== ev.totalPaise) {
          throw new ApiError(
            422,
            'CONFIRMATION_MISMATCH',
            'Recipients or estimated cost changed since you reviewed them. Review the preview again.',
            [],
            {},
            { eligibleCount: ev.eligible.length, estimatedCostPaise: ev.totalPaise },
          );
        }
        const cap =
          this.cfg.MESSAGING_MODE === 'live'
            ? Math.min(ws.message_spend_cap_paise ?? Infinity, this.cfg.LIVE_SPEND_CAP_PAISE ?? Infinity)
            : (ws.message_spend_cap_paise ?? Infinity);
        if (cap !== Infinity) {
          const used = (await q.one<{ s: number }>(
            `SELECT COALESCE(sum(estimated_cost_paise),0)::bigint AS s FROM scheduled_messages WHERE workspace_id=$1 AND status NOT IN ('cancelled','skipped','failed')`,
            [ctx.workspace!.id],
          ))!.s;
          if (used + ev.totalPaise > cap)
            throw new ApiError(
              422,
              'SPEND_CAP_EXCEEDED',
              'This would exceed the workspace message spend cap',
              [],
              {},
              { capPaise: cap, committedPaise: used, requestedPaise: ev.totalPaise },
            );
        }
        let when = new Date();
        if (i.scheduledAt) {
          const p = parseEventTime(i.scheduledAt, event.timezone);
          if (!p) throw unprocessable('INVALID_DATETIME', 'scheduledAt is not a valid date/time');
          if (p.getTime() > Date.now() + 365 * 86_400_000) throw unprocessable('INVALID_DATETIME', 'scheduledAt is too far in the future');
          when = p;
        }
        await q.query(
          `INSERT INTO scheduled_messages (workspace_id,event_function_id,campaign_id,invitation_id,channel,template_key,template_version,language,scheduled_at,next_attempt_at,idempotency_key,estimated_cost_paise)
         SELECT $1::uuid,$2::uuid,$3::uuid,x.inv,$4,$5,$6::int,x.lang,$7::timestamptz,$7::timestamptz,'m_' || encode(sha256(convert_to($3::uuid::text || ':' || x.inv::text,'UTF8')),'hex'),$8::int
           FROM unnest($9::uuid[], $10::text[]) AS x(inv, lang) ON CONFLICT (campaign_id, invitation_id) DO NOTHING`,
          [
            ctx.workspace!.id,
            functionId,
            campaignId,
            c.channel,
            c.template_key,
            c.template_version,
            when,
            ev.perMessagePaise,
            ev.eligible.map((x) => x.r.invitation_id),
            ev.eligible.map((x) => x.r.preferred_language),
          ],
        );
        const upd = await q.one<any>(
          `UPDATE message_campaigns SET status='scheduled', scheduled_at=$2, estimated_recipients=$3, estimated_cost_paise=$4, confirmed_by=$5, confirmed_at=now(), updated_at=now() WHERE id=$1 RETURNING *`,
          [campaignId, when, ev.eligible.length, ev.totalPaise, ctx.user!.id],
        );
        await this.outbox.enqueue(q, {
          workspaceId: ctx.workspace!.id,
          type: 'campaign.scheduled',
          aggregateId: campaignId,
          payload: { recipients: ev.eligible.length },
        });
        await this.audit.log(q, ctx, {
          workspaceId: ctx.workspace!.id,
          action: 'campaign.scheduled',
          resourceType: 'campaign',
          resourceId: campaignId,
          metadata: {
            recipients: ev.eligible.length,
            estimatedCostPaise: ev.totalPaise,
            excluded: ev.excluded,
            scheduledAt: when.toISOString(),
          },
        });
        await this.analytics.track(q, 'campaign_scheduled', {
          workspaceId: ctx.workspace!.id,
          eventId,
          props: { kind: c.kind, channel: c.channel, recipients: ev.eligible.length },
        });
        return { status: 200, body: { campaign: this.dto(upd), scheduled: ev.eligible.length, excludedCounts: ev.excluded } };
      },
    );
  }

  private async transition(
    ctx: RequestCtx,
    eventId: string,
    functionId: string,
    campaignId: string,
    action: 'pause' | 'resume' | 'cancel',
    reason?: string,
  ) {
    return this.db.tx(async (q) => {
      const { c } = await this.load(ctx, eventId, functionId, campaignId, q, true);
      let next = c.status as string;
      if (action === 'pause') {
        if (c.status === 'paused') return this.dto(c);
        if (!['scheduled', 'running'].includes(c.status))
          throw new ApiError(409, 'INVALID_STATE', `A ${c.status} campaign cannot be paused`);
        next = 'paused';
      } else if (action === 'resume') {
        if (c.status !== 'paused') throw new ApiError(409, 'INVALID_STATE', 'Only a paused campaign can be resumed');
        const n = await q.one<{ n: number }>(
          `SELECT count(*)::int AS n FROM scheduled_messages WHERE campaign_id=$1 AND status IN ('scheduled','queued')`,
          [campaignId],
        );
        next = n!.n > 0 ? 'scheduled' : 'completed';
      } else {
        if (c.status === 'cancelled') return this.dto(c);
        if (c.status === 'completed') throw new ApiError(409, 'INVALID_STATE', 'A completed campaign cannot be cancelled');
        next = 'cancelled';
        // Includes 'queued': the dispatcher re-checks state atomically right before calling the provider.
        await q.query(
          `UPDATE scheduled_messages SET status='cancelled', skip_reason='campaign_cancelled', locked_until=NULL, updated_at=now() WHERE campaign_id=$1 AND status = ANY($2::text[])`,
          [campaignId, PENDING],
        );
      }
      const upd = await q.one<any>(`UPDATE message_campaigns SET status=$2, updated_at=now() WHERE id=$1 RETURNING *`, [campaignId, next]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: `campaign.${action === 'cancel' ? 'cancelled' : action + 'd'}`,
        resourceType: 'campaign',
        resourceId: campaignId,
        reason,
      });
      return this.dto(upd);
    });
  }
  pause(ctx: RequestCtx, e: string, f: string, id: string) {
    return this.transition(ctx, e, f, id, 'pause');
  }
  resume(ctx: RequestCtx, e: string, f: string, id: string) {
    return this.transition(ctx, e, f, id, 'resume');
  }
  cancel(ctx: RequestCtx, e: string, f: string, id: string, reason?: string) {
    return this.transition(ctx, e, f, id, 'cancel', reason);
  }

  async messages(ctx: RequestCtx, eventId: string, functionId: string, campaignId: string, p: z.infer<typeof messagesQuery>) {
    const { c } = await this.load(ctx, eventId, functionId, campaignId);
    const params: unknown[] = [campaignId, ctx.workspace!.id];
    let where = 'm.campaign_id=$1 AND m.workspace_id=$2';
    if (p.status) {
      params.push(p.status);
      where += ` AND m.status=$${params.length}`;
    }
    const total = (await this.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM scheduled_messages m WHERE ${where}`, params))!.c;
    params.push(p.limit, (p.page - 1) * p.limit);
    const rows = await this.db.query<any>(
      `SELECT m.id, m.status, m.skip_reason, m.attempt_count, m.last_error_code, m.scheduled_at, m.updated_at, m.dead_lettered_at, g.display_name, g.phone_e164, g.email
         FROM scheduled_messages m JOIN event_invitations i ON i.id=m.invitation_id JOIN guests g ON g.id=i.guest_id WHERE ${where} ORDER BY g.display_name, m.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      data: rows.map((m) => ({
        id: m.id,
        guestName: m.display_name,
        contact: c.channel === 'email' ? maskEmail(m.email) : maskPhone(m.phone_e164),
        status: m.status,
        skipReason: m.skip_reason,
        attempts: m.attempt_count,
        lastErrorCode: m.last_error_code,
        deadLettered: !!m.dead_lettered_at,
        scheduledAt: m.scheduled_at,
        updatedAt: m.updated_at,
      })),
      page: p.page,
      limit: p.limit,
      total,
    };
  }

  /** Controlled replay of a failed/unknown message. Same idempotency key, so a provider that already accepted it dedupes. */
  async retry(ctx: RequestCtx, eventId: string, functionId: string, campaignId: string, messageId: string, reason: string) {
    return this.db.tx(async (q) => {
      const { c } = await this.load(ctx, eventId, functionId, campaignId, q, true);
      if (['cancelled', 'paused'].includes(c.status))
        throw new ApiError(409, 'INVALID_STATE', 'Resume the campaign before retrying messages');
      const m = await q.one<any>(
        `SELECT id, status FROM scheduled_messages WHERE id=$1 AND campaign_id=$2 AND workspace_id=$3 FOR UPDATE`,
        [messageId, campaignId, ctx.workspace!.id],
      );
      if (!m) throw notFound('Message');
      if (!['failed', 'unknown'].includes(m.status))
        throw new ApiError(409, 'INVALID_STATE', 'Only failed or unconfirmed messages can be retried');
      await q.query(
        `UPDATE scheduled_messages SET status='scheduled', attempt_count=0, next_attempt_at=now(), dead_lettered_at=NULL, last_error_code=NULL, updated_at=now() WHERE id=$1`,
        [messageId],
      );
      await q.query(
        `INSERT INTO message_status_history (workspace_id,scheduled_message_id,from_status,to_status,source) VALUES ($1,$2,$3,'scheduled','organizer')`,
        [ctx.workspace!.id, messageId, m.status],
      );
      if (c.status === 'completed')
        await q.query(`UPDATE message_campaigns SET status='scheduled', updated_at=now() WHERE id=$1`, [campaignId]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'message.retry_requested',
        resourceType: 'message',
        resourceId: messageId,
        reason,
      });
      return { id: messageId, status: 'scheduled' };
    });
  }

  // ---------- sandbox tools (fake provider only) ----------
  private assertSandbox() {
    if (this.cfg.MESSAGING_MODE !== 'fake') throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
  }
  async simulate(
    ctx: RequestCtx,
    eventId: string,
    functionId: string,
    campaignId: string,
    messageId: string,
    ev: 'delivered' | 'read' | 'failed' | 'opted_out',
  ) {
    this.assertSandbox();
    await this.load(ctx, eventId, functionId, campaignId);
    const m = await this.db.one<any>(
      `SELECT provider_message_id FROM scheduled_messages WHERE id=$1 AND campaign_id=$2 AND workspace_id=$3`,
      [messageId, campaignId, ctx.workspace!.id],
    );
    if (!m) throw notFound('Message');
    if (!m.provider_message_id) throw new ApiError(409, 'INVALID_STATE', 'This message has not been submitted to the provider yet');
    return this.webhooks.applySimulated(ctx, 'fake', { type: ev, providerMessageId: m.provider_message_id });
  }
  async testInbox(ctx: RequestCtx) {
    this.assertSandbox();
    const rows = await this.db.query<any>(
      `SELECT provider_message_id, channel, to_masked, template_key, language, body, created_at FROM fake_provider_messages WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [ctx.workspace!.id],
    );
    return {
      data: rows.map((r) => ({
        providerMessageId: r.provider_message_id,
        channel: r.channel,
        to: r.to_masked,
        templateKey: r.template_key,
        language: r.language,
        body: r.body,
        createdAt: r.created_at,
      })),
      note: 'Sandbox provider output. No real message was sent.',
    };
  }
}
export type { ExclusionReason };
export { contactFor };
