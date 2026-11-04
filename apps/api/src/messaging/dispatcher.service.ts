import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { DbService, Q } from '../common/db.service';
import { AnalyticsService } from '../audit/audit.service';
import { CONFIG, Config } from '../config/config';
import { addMinutes, nextAllowedSendTime } from '../common/time';
import { TokensService } from '../invitations/tokens.service';
import { Audience, EligibilityService, contactFor } from './eligibility.service';
import { ProviderFactory } from './provider';
import { formatWhen, getTemplate, renderTemplate } from './templates';
import { SuppressionService } from '../guests/suppression.service';

export interface DispatchStats {
  claimed: number;
  submitted: number;
  skipped: number;
  deferred: number;
  retried: number;
  failed: number;
  unknown: number;
  cancelled: number;
}
const BATCH = 25;
const LEASE_SECONDS = 120;

/**
 * Message worker. Safe to run in several processes: rows are claimed with FOR UPDATE SKIP LOCKED and carry a lease;
 * crashed workers' leases expire and are reclaimed. Eligibility is re-evaluated immediately before every provider call.
 */
@Injectable()
export class DispatcherService {
  constructor(
    private readonly db: DbService,
    private readonly elig: EligibilityService,
    private readonly providers: ProviderFactory,
    private readonly tokens: TokensService,
    private readonly analytics: AnalyticsService,
    private readonly suppression: SuppressionService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async runOnce(now = new Date()): Promise<DispatchStats> {
    const stats: DispatchStats = { claimed: 0, submitted: 0, skipped: 0, deferred: 0, retried: 0, failed: 0, unknown: 0, cancelled: 0 };
    await this.reclaimExpiredLeases(now);
    const claimed = await this.db.query<any>(
      `UPDATE scheduled_messages m SET status='queued', locked_until=$1::timestamptz + make_interval(secs => $3), updated_at=now()
        WHERE m.id IN (SELECT m2.id FROM scheduled_messages m2 JOIN message_campaigns c ON c.id=m2.campaign_id
                        WHERE m2.status='scheduled' AND m2.next_attempt_at <= $1 AND c.status IN ('scheduled','running')
                        ORDER BY m2.next_attempt_at, m2.id LIMIT $2 FOR UPDATE OF m2 SKIP LOCKED) RETURNING m.*`,
      [now, BATCH, LEASE_SECONDS],
    );
    await this.markRunning(claimed.map((m) => m.campaign_id));
    for (const m of claimed) {
      stats.claimed++;
      await this.processSafely(m, now, stats);
    }
    await this.refreshCampaigns();
    return stats;
  }

  /** Re-attempts messages left in the 'unknown' state (provider may or may not have accepted them) using the SAME idempotency key. */
  async reconcileUnknown(now = new Date(), olderThanSeconds = 60): Promise<DispatchStats> {
    const stats: DispatchStats = { claimed: 0, submitted: 0, skipped: 0, deferred: 0, retried: 0, failed: 0, unknown: 0, cancelled: 0 };
    const rows = await this.db.query<any>(
      `UPDATE scheduled_messages m SET status='queued', locked_until=$1::timestamptz + make_interval(secs => $3), updated_at=now()
        WHERE m.id IN (SELECT m2.id FROM scheduled_messages m2 JOIN message_campaigns c ON c.id=m2.campaign_id
                        WHERE m2.status='unknown' AND m2.updated_at <= $1::timestamptz - make_interval(secs => $2) AND c.status IN ('scheduled','running','completed')
                        ORDER BY m2.updated_at LIMIT $4 FOR UPDATE OF m2 SKIP LOCKED) RETURNING m.*`,
      [now, olderThanSeconds, LEASE_SECONDS, BATCH],
    );
    for (const m of rows) {
      stats.claimed++;
      await this.processSafely(m, now, stats);
    }
    await this.refreshCampaigns();
    return stats;
  }

  /**
   * One failing message must not abort the batch or loop forever. An unexpected exception (provider adapter bug,
   * transient database error) counts as an attempt: retry with exponential backoff, then dead-letter at the max attempts.
   */
  private async processSafely(m: any, now: Date, stats: DispatchStats) {
    try {
      await this.process(m, now, stats);
    } catch (e) {
      process.stderr.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'error',
          msg: 'dispatch_exception',
          messageId: m.id,
          errorMessage: (e as Error).message,
        }) + '\n',
      );
      try {
        const r = await this.db.one<{ attempt_count: number }>(`SELECT attempt_count FROM scheduled_messages WHERE id=$1`, [m.id]);
        const n = r?.attempt_count ?? 0;
        if (n >= this.cfg.MESSAGE_MAX_ATTEMPTS) {
          if (await this.setStatus(m, 'failed', { error: 'DISPATCH_EXCEPTION', deadLetter: true })) stats.failed++;
        } else {
          const delayMs = this.cfg.MESSAGE_BACKOFF_BASE_SECONDS * 1000 * 2 ** Math.max(0, n - 1);
          if (await this.setStatus(m, 'scheduled', { error: 'DISPATCH_EXCEPTION', nextAt: new Date(now.getTime() + delayMs) }))
            stats.retried++;
        }
      } catch {
        // Database unavailable: the lease expires and the message is reclaimed on a later tick.
      }
    }
  }

  private async reclaimExpiredLeases(now: Date) {
    await this.db.query(
      `UPDATE scheduled_messages SET status='scheduled', locked_until=NULL, updated_at=now() WHERE status='queued' AND locked_until < $1`,
      [now],
    );
  }
  private async markRunning(campaignIds: string[]) {
    if (campaignIds.length)
      await this.db.query(
        `UPDATE message_campaigns SET status='running', updated_at=now() WHERE id = ANY($1::uuid[]) AND status='scheduled'`,
        [[...new Set(campaignIds)]],
      );
  }
  private async refreshCampaigns() {
    await this.db.query(
      `UPDATE message_campaigns c SET status='completed', updated_at=now() WHERE c.status IN ('scheduled','running')
         AND NOT EXISTS (SELECT 1 FROM scheduled_messages m WHERE m.campaign_id=c.id AND m.status IN ('scheduled','queued','unknown'))`,
    );
  }

  private hist(q: Q, m: any, from: string | null, to: string, source: 'worker' | 'scheduler' | 'system' = 'worker') {
    return q.query(
      `INSERT INTO message_status_history (workspace_id,scheduled_message_id,from_status,to_status,source) VALUES ($1,$2,$3,$4,$5)`,
      [m.workspace_id, m.id, from, to, source],
    );
  }
  private async setStatus(
    m: any,
    to: string,
    extra: { skip?: string; error?: string | null; nextAt?: Date; providerMessageId?: string; deadLetter?: boolean } = {},
  ) {
    const updated = await this.db.tx(async (q) => {
      const r = await q.query(
        `UPDATE scheduled_messages SET status=$2, skip_reason=COALESCE($3,skip_reason), last_error_code=$4, next_attempt_at=COALESCE($5,next_attempt_at), scheduled_at=CASE WHEN $5::timestamptz IS NOT NULL AND $2='scheduled' THEN $5 ELSE scheduled_at END,
                provider=COALESCE($6::text, provider), provider_message_id=COALESCE($7,provider_message_id), dead_lettered_at=CASE WHEN $8 THEN now() ELSE dead_lettered_at END, locked_until=NULL, updated_at=now()
          WHERE id=$1 AND (status='queued' OR (status='cancelled' AND $2 IN ('submitted','unknown'))) RETURNING id`,
        [
          m.id,
          to,
          extra.skip ?? null,
          extra.error ?? null,
          extra.nextAt ?? null,
          extra.providerMessageId ? this.providers.get().name : null,
          extra.providerMessageId ?? null,
          !!extra.deadLetter,
        ],
      );
      if (r.length) {
        await this.hist(q, m, m.status === 'queued' ? 'queued' : m.status, to);
        if (to === 'submitted')
          await q.query(`UPDATE event_invitations SET status='sent', updated_at=now() WHERE id=$1 AND status='pending'`, [m.invitation_id]);
      }
      return r.length > 0;
    });
    if (updated) await this.analytics.track(null, 'message_status_changed', { workspaceId: m.workspace_id, props: { to } });
    return updated;
  }

  private async process(m: any, now: Date, stats: DispatchStats) {
    const camp = await this.db.one<any>(`SELECT * FROM message_campaigns WHERE id=$1`, [m.campaign_id]);
    if (!camp || camp.status === 'cancelled') {
      await this.setStatus(m, 'cancelled', { skip: 'campaign_cancelled' });
      stats.cancelled++;
      return;
    }
    if (camp.status === 'paused') {
      await this.setStatus(m, 'scheduled');
      stats.deferred++;
      return;
    }

    const rows = await this.elig.candidates(this.db, m.workspace_id, m.event_function_id, m.channel, m.invitation_id);
    const cand = rows[0];
    const suppressed = cand ? await this.elig.suppressedContacts(this.db, m.workspace_id, m.channel, rows) : new Set<string>();
    const reason = !cand
      ? 'invitation_revoked'
      : this.elig.reason(cand, {
          kind: camp.kind,
          channel: m.channel,
          audience: camp.audience as Audience,
          now,
          suppressedContacts: suppressed,
        });
    if (reason || !cand) {
      await this.setStatus(m, 'skipped', { skip: reason ?? 'invitation_revoked' });
      stats.skipped++;
      return;
    }

    const ws = await this.db.one<any>(
      `SELECT quiet_hours_start, quiet_hours_end, contact_authority_attested_at FROM workspaces WHERE id=$1 AND deleted_at IS NULL`,
      [m.workspace_id],
    );
    if (!ws || !ws.contact_authority_attested_at) {
      await this.setStatus(m, 'skipped', { skip: 'workspace_not_attested' });
      stats.skipped++;
      return;
    }
    const allowed = nextAllowedSendTime(now, cand.timezone, ws.quiet_hours_start, ws.quiet_hours_end);
    if (allowed > now) {
      await this.setStatus(m, 'scheduled', { nextAt: allowed });
      stats.deferred++;
      return;
    }
    const recent = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM message_attempts WHERE workspace_id=$1 AND started_at > $2::timestamptz - interval '60 seconds'`,
      [m.workspace_id, now],
    );
    if (recent!.n >= this.cfg.MESSAGE_RATE_PER_MINUTE_PER_WORKSPACE) {
      await this.setStatus(m, 'scheduled', { nextAt: addMinutes(now, 1) });
      stats.deferred++;
      return;
    }

    const t = getTemplate(m.template_key, m.template_version);
    if (!t) {
      await this.setStatus(m, 'failed', { error: 'TEMPLATE_UNAVAILABLE', deadLetter: true });
      stats.failed++;
      return;
    }
    let body: string;
    try {
      body = renderTemplate(t, m.language, {
        guest_name: cand.display_name,
        event_name: cand.event_name,
        function_name: cand.function_name,
        function_datetime: formatWhen(cand.starts_at, cand.timezone, m.language),
        venue: cand.venue ?? (m.language === 'hi' ? 'स्थान' : 'the venue'),
        rsvp_deadline: formatWhen(cand.rsvp_deadline, cand.timezone, m.language) || 'soon',
        rsvp_link: this.tokens.link(cand.invitation_id, cand.token_version),
      });
    } catch {
      await this.setStatus(m, 'failed', { error: 'TEMPLATE_RENDER_FAILED', deadLetter: true });
      stats.failed++;
      return;
    }

    // Atomic pre-send guard: only proceeds if the message is still queued AND its campaign is still live.
    const guard = await this.db.one<{ attempt_count: number }>(
      `UPDATE scheduled_messages m SET attempt_count = attempt_count + 1, updated_at=now() WHERE m.id=$1 AND m.status='queued'
          AND EXISTS (SELECT 1 FROM message_campaigns c WHERE c.id=m.campaign_id AND c.status IN ('scheduled','running','completed')) RETURNING attempt_count`,
      [m.id],
    );
    if (!guard) {
      stats.cancelled++;
      return;
    }
    const attempt = guard.attempt_count;
    await this.db.query(
      `INSERT INTO message_attempts (workspace_id,scheduled_message_id,attempt_number,status) VALUES ($1,$2,$3,'started')`,
      [m.workspace_id, m.id, attempt],
    );

    const provider = this.providers.get();
    const res = await provider.send({
      workspaceId: m.workspace_id,
      idempotencyKey: m.idempotency_key,
      attempt,
      channel: m.channel,
      to: contactFor(cand, m.channel)!,
      templateKey: m.template_key,
      templateVersion: m.template_version,
      language: m.language,
      body,
    });
    const finish = (status: string, providerMessageId?: string, code?: string) =>
      this.db.query(
        `UPDATE message_attempts SET status=$3, provider_message_id=$4, error_code=$5, finished_at=now() WHERE scheduled_message_id=$1 AND attempt_number=$2`,
        [m.id, attempt, status, providerMessageId ?? null, code ?? null],
      );

    if (res.outcome === 'accepted') {
      await finish('submitted', res.providerMessageId);
      // Provider accepted: record the truth even if the campaign was cancelled a moment ago ('cancelled' is also accepted here).
      await this.setStatus(m, 'submitted', { providerMessageId: res.providerMessageId, error: null });
      stats.submitted++;
    } else if (res.outcome === 'permanent_error') {
      await finish('permanent_error', undefined, res.code);
      await this.setStatus(m, 'failed', { error: res.code, deadLetter: true });
      stats.failed++;
    } else if (res.outcome === 'timeout') {
      await finish('timeout', undefined, 'TIMEOUT');
      if (attempt >= this.cfg.MESSAGE_MAX_ATTEMPTS) {
        await this.setStatus(m, 'failed', { error: 'TIMEOUT_UNRECONCILED', deadLetter: true });
        stats.failed++;
      } else {
        await this.setStatus(m, 'unknown', { error: 'TIMEOUT' });
        stats.unknown++;
      }
    } else {
      await finish('transient_error', undefined, res.code);
      if (attempt >= this.cfg.MESSAGE_MAX_ATTEMPTS) {
        await this.setStatus(m, 'failed', { error: res.code, deadLetter: true });
        stats.failed++;
      } else {
        const base = this.cfg.MESSAGE_BACKOFF_BASE_SECONDS;
        const delay = base * 2 ** (attempt - 1) + (base ? randomInt(0, base + 1) : 0);
        await this.setStatus(m, 'scheduled', { error: res.code, nextAt: new Date(now.getTime() + delay * 1000) });
        stats.retried++;
      }
    }
  }
}
export { SuppressionService };
