import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, Q } from '../common/db.service';
import { ApiError, notFound, tooMany, unprocessable } from '../common/errors';
import { IdempotencyService } from '../common/idempotency.service';
import { RateLimitService } from '../common/rate-limit.service';
import { OutboxService } from '../common/outbox.service';
import { ScopeService } from '../common/scope.service';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { TokensService } from '../invitations/tokens.service';
import { CONFIG, Config } from '../config/config';
import { toEventLocal } from '../common/time';
import type { RequestCtx } from '../common/request';

export const rsvpSchema = z.object({
  status: z.enum(['yes', 'no', 'maybe']),
  adultCount: z.number().int().min(0).max(100).default(0),
  childCount: z.number().int().min(0).max(100).default(0),
  version: z.number().int().min(0),
});
export const overrideSchema = rsvpSchema.extend({
  version: z.number().int().min(0).optional(),
  reason: z.string().trim().min(3, 'Give a short reason').max(300),
  allowExceedPartySize: z.boolean().default(false),
});

type Row = any;
export type RsvpState = 'open' | 'locked' | 'closed_deadline' | 'closed_cancelled' | 'closed_completed';

export function stateOf(r: Row, now = new Date()): RsvpState {
  if (r.event_status === 'cancelled' || r.event_status === 'archived' || r.fn_status === 'cancelled') return 'closed_cancelled';
  if (r.fn_status === 'completed' || r.event_status === 'completed') return 'closed_completed';
  if (r.rsvp_deadline && new Date(r.rsvp_deadline) <= now) return 'closed_deadline';
  if (r.r_status && !r.allow_response_edits) return 'locked';
  return 'open';
}

/** Validates counts against the response status, child policy and invited party size. Pure; unit-tested. */
export function normalizeCounts(
  status: 'yes' | 'no' | 'maybe',
  adults: number,
  children: number,
  cap: number,
  allowChildren: boolean,
  allowExceed = false,
): { adults: number; children: number } {
  if (status === 'no') return { adults: 0, children: 0 };
  if (children > 0 && !allowChildren)
    throw unprocessable('CHILDREN_NOT_ALLOWED', 'This function does not include children in the headcount', [
      { field: 'childCount', message: 'Children are not included for this function' },
    ]);
  if (status === 'yes' && adults + children < 1)
    throw unprocessable('COUNT_REQUIRED', 'Tell us how many people will attend', [
      { field: 'adultCount', message: 'At least one person is required for Yes' },
    ]);
  if (!allowExceed && adults + children > cap)
    throw unprocessable('PARTY_SIZE_EXCEEDED', `This invitation covers up to ${cap} people`, [
      { field: 'adultCount', message: `Maximum ${cap}` },
    ]);
  return { adults, children };
}

@Injectable()
export class RsvpService {
  constructor(
    private readonly db: DbService,
    private readonly tokens: TokensService,
    private readonly idem: IdempotencyService,
    private readonly limiter: RateLimitService,
    private readonly outbox: OutboxService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private static readonly SELECT = `
    SELECT i.id, i.workspace_id, i.event_id, i.event_function_id, i.invited_party_size, i.token_version, i.revoked_at, i.token_expires_at,
           g.display_name, g.preferred_language, f.name AS fn_name, f.starts_at, f.venue, f.rsvp_deadline, f.allow_response_edits, f.allow_children, f.status AS fn_status,
           e.name AS event_name, e.timezone, e.status AS event_status,
           r.status AS r_status, r.adult_count, r.child_count, r.version AS r_version, r.responded_at
      FROM event_invitations i JOIN guests g ON g.id=i.guest_id JOIN event_functions f ON f.id=i.event_function_id JOIN events e ON e.id=i.event_id
      LEFT JOIN rsvp_responses r ON r.invitation_id=i.id`;

  /** Resolves a bearer token. Invalid-token attempts draw down a per-IP budget; all failures look alike (no oracle). */
  private async resolve(ctx: RequestCtx, token: string, q: Q = this.db): Promise<Row> {
    this.limiter.hit(`public:ip:${ctx.ip}`, this.cfg.RATE_LIMIT_PUBLIC_PER_MIN);
    if (this.limiter.count(`public:invalid:${ctx.ip}`) >= this.cfg.RATE_LIMIT_PUBLIC_INVALID_PER_MIN) throw tooMany(60);
    const fail = () => {
      this.limiter.hit(`public:invalid:${ctx.ip}`, this.cfg.RATE_LIMIT_PUBLIC_INVALID_PER_MIN);
      return notFound('Invitation');
    };
    if (!this.tokens.isWellFormed(token)) throw fail();
    const hash = this.tokens.hash(token);
    this.limiter.hit(`public:tok:${hash}`, this.cfg.RATE_LIMIT_PUBLIC_PER_MIN);
    const row = await q.one<Row>(`${RsvpService.SELECT} WHERE i.token_hash=$1 AND g.deleted_at IS NULL AND e.deleted_at IS NULL`, [hash]);
    if (!row) throw fail();
    if (row.revoked_at || (row.token_expires_at && new Date(row.token_expires_at) <= new Date())) {
      throw new ApiError(410, 'INVITATION_UNAVAILABLE', 'This invitation link is no longer valid. Please contact the host.');
    }
    return row;
  }

  private dto(r: Row) {
    const state = stateOf(r);
    return {
      guestName: r.display_name,
      language: r.preferred_language,
      event: { name: r.event_name, timezone: r.timezone },
      function: { name: r.fn_name, startsAt: r.starts_at, startsAtLocal: toEventLocal(r.starts_at, r.timezone), venue: r.venue },
      partySizeMax: r.invited_party_size,
      allowChildren: r.allow_children,
      deadline: r.rsvp_deadline,
      deadlineLocal: toEventLocal(r.rsvp_deadline, r.timezone),
      state,
      response: r.r_status
        ? { status: r.r_status, adultCount: r.adult_count, childCount: r.child_count, version: r.r_version, respondedAt: r.responded_at }
        : null,
      // The check-in QR value is only handed to a guest who has said Yes.
      checkinCode: r.r_status === 'yes' ? this.tokens.checkinCode(r.id, r.token_version) : null,
    };
  }

  async view(ctx: RequestCtx, token: string) {
    const r = await this.resolve(ctx, token);
    await this.analytics.track(null, 'invitation_link_opened', { workspaceId: r.workspace_id, eventId: r.event_id });
    return this.dto(r);
  }

  async submit(ctx: RequestCtx, token: string, key: string | undefined, body: z.infer<typeof rsvpSchema>) {
    const first = await this.resolve(ctx, token);
    return this.idem.run({ scope: `public|inv:${first.id}`, operation: 'rsvp.submit', key, required: true, request: body }, async (q) => {
      await q.query(`SELECT 1 FROM event_invitations WHERE id=$1 FOR UPDATE`, [first.id]); // serialise concurrent edits
      const r = await q.one<Row>(`${RsvpService.SELECT} WHERE i.id=$1`, [first.id]);
      if (!r || r.revoked_at)
        throw new ApiError(410, 'INVITATION_UNAVAILABLE', 'This invitation link is no longer valid. Please contact the host.');
      const state = stateOf(r);
      if (state === 'closed_deadline')
        throw new ApiError(409, 'RSVP_DEADLINE_PASSED', 'The RSVP deadline has passed. Please contact the host.');
      if (state === 'closed_cancelled' || state === 'closed_completed')
        throw new ApiError(409, 'RSVP_CLOSED', 'RSVPs are closed for this function.');
      if (state === 'locked')
        throw new ApiError(409, 'RESPONSE_EDITS_DISABLED', 'Responses can no longer be changed. Please contact the host.');
      const curVersion = r.r_version ?? 0;
      if (body.version !== curVersion) {
        throw new ApiError(
          409,
          'VERSION_CONFLICT',
          'This RSVP was changed elsewhere. Review the latest answer and try again.',
          [],
          {},
          { current: this.dto(r).response },
        );
      }
      const c = normalizeCounts(body.status, body.adultCount, body.childCount, r.invited_party_size, r.allow_children);
      await this.write(q, r, { status: body.status, ...c, actorType: 'guest', actorId: null, reason: null, override: false });
      await this.audit.log(
        q,
        { requestId: ctx.requestId },
        {
          workspaceId: r.workspace_id,
          actorType: 'guest',
          action: 'rsvp.submitted',
          resourceType: 'invitation',
          resourceId: r.id,
          metadata: { status: body.status, version: curVersion + 1 },
        },
      );
      await this.analytics.track(q, 'rsvp_submitted', {
        workspaceId: r.workspace_id,
        eventId: r.event_id,
        props: { status: body.status, edited: curVersion > 0 },
      });
      const fresh = await q.one<Row>(`${RsvpService.SELECT} WHERE i.id=$1`, [r.id]);
      return { status: curVersion === 0 ? 201 : 200, body: this.dto(fresh!) };
    });
  }

  /** Upsert + append-only history + invitation status + outbox event, all in the caller's transaction. */
  private async write(
    q: Q,
    r: Row,
    w: {
      status: string;
      adults: number;
      children: number;
      actorType: 'guest' | 'organizer';
      actorId: string | null;
      reason: string | null;
      override: boolean;
      overrideReason?: string | null;
    },
  ) {
    const prev = r.r_status ? { status: r.r_status, adults: r.adult_count, children: r.child_count, version: r.r_version } : null;
    const version = (prev?.version ?? 0) + 1;
    if (prev) {
      await q.query(
        `UPDATE rsvp_responses SET status=$2, adult_count=$3, child_count=$4, version=$5, updated_at=now(), last_actor_type=$6, override_reason=$7, override_by=$8 WHERE invitation_id=$1`,
        [r.id, w.status, w.adults, w.children, version, w.actorType, w.overrideReason ?? null, w.overrideReason ? w.actorId : null],
      );
    } else {
      await q.query(
        `INSERT INTO rsvp_responses (workspace_id, invitation_id, status, adult_count, child_count, version, last_actor_type, override_reason, override_by) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)`,
        [r.workspace_id, r.id, w.status, w.adults, w.children, w.actorType, w.overrideReason ?? null, w.overrideReason ? w.actorId : null],
      );
    }
    await q.query(
      `INSERT INTO rsvp_response_history (workspace_id, invitation_id, response_version, previous_status, new_status, previous_adult_count, previous_child_count, new_adult_count, new_child_count, actor_type, actor_id, reason, is_override)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        r.workspace_id,
        r.id,
        version,
        prev?.status ?? null,
        w.status,
        prev?.adults ?? null,
        prev?.children ?? null,
        w.adults,
        w.children,
        w.actorType,
        w.actorId,
        w.reason,
        w.override,
      ],
    );
    await q.query(`UPDATE event_invitations SET status='responded', updated_at=now() WHERE id=$1 AND revoked_at IS NULL`, [r.id]);
    await this.outbox.enqueue(q, {
      workspaceId: r.workspace_id,
      type: 'rsvp.changed',
      aggregateId: r.id,
      payload: { invitationId: r.id, functionId: r.event_function_id, status: w.status, version },
    });
  }

  /** Authorized organizer correction: bypasses deadline/edit-lock, never skips audit, needs a reason. */
  async override(ctx: RequestCtx, eventId: string, functionId: string, invitationId: string, body: z.infer<typeof overrideSchema>) {
    return this.db.tx(async (q) => {
      await this.scope.fn(ctx, eventId, functionId, q);
      await q.query(`SELECT 1 FROM event_invitations WHERE id=$1 AND workspace_id=$2 AND event_function_id=$3 FOR UPDATE`, [
        invitationId,
        ctx.workspace!.id,
        functionId,
      ]);
      const r = await q.one<Row>(`${RsvpService.SELECT} WHERE i.id=$1 AND i.workspace_id=$2 AND i.event_function_id=$3`, [
        invitationId,
        ctx.workspace!.id,
        functionId,
      ]);
      if (!r) throw notFound('Invitation');
      if (r.revoked_at) throw new ApiError(409, 'INVITATION_REVOKED', 'Restore the invitation before correcting its RSVP');
      if (body.version !== undefined && body.version !== (r.r_version ?? 0)) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'This RSVP changed since you loaded it', [], {}, { current: this.dto(r).response });
      }
      const c = normalizeCounts(
        body.status,
        body.adultCount,
        body.childCount,
        r.invited_party_size,
        r.allow_children,
        body.allowExceedPartySize,
      );
      const exceeds = c.adults + c.children > r.invited_party_size;
      await this.write(q, r, {
        status: body.status,
        ...c,
        actorType: 'organizer',
        actorId: ctx.user!.id,
        reason: body.reason,
        override: true,
        overrideReason: exceeds ? body.reason : null,
      });
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'rsvp.overridden',
        resourceType: 'invitation',
        resourceId: invitationId,
        reason: body.reason,
        metadata: { from: r.r_status ?? null, to: body.status, exceededPartySize: exceeds },
      });
      const fresh = await q.one<Row>(`${RsvpService.SELECT} WHERE i.id=$1`, [invitationId]);
      return this.dto(fresh!).response;
    });
  }
}
