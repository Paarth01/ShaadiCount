import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, isUniqueViolation } from '../common/db.service';
import { ApiError, forbidden, notFound, unprocessable } from '../common/errors';
import { IdempotencyService } from '../common/idempotency.service';
import { ScopeService } from '../common/scope.service';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { TokensService } from '../invitations/tokens.service';
import { can } from '../auth/permissions';
import type { RequestCtx } from '../common/request';

export const searchSchema = z.object({ q: z.string().trim().min(2, 'Type at least 2 letters').max(60) });
export const checkInSchema = z
  .object({
    invitationId: z.string().uuid().optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z2-9]{12}$/, 'Invalid check-in code')
      .optional(),
    adults: z.number().int().min(0).max(100).optional(),
    children: z.number().int().min(0).max(100).optional(),
    allowUnconfirmed: z.boolean().default(false),
    note: z.string().trim().max(300).optional(),
  })
  .refine((b) => !!b.invitationId !== !!b.code, { message: 'Provide exactly one of invitationId or code' });
export const voidSchema = z.object({ reason: z.string().trim().min(3).max(300) });

const dto = (c: any) => ({
  id: c.id,
  invitationId: c.invitation_id,
  adults: c.adults_present,
  children: c.children_present,
  method: c.method,
  checkedInAt: c.checked_in_at,
  note: c.note,
});

@Injectable()
export class CheckinService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly tokens: TokensService,
    private readonly idem: IdempotencyService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Minimal lookup for gate staff: name, group, party and RSVP counts, last 4 phone digits. No full contact details. */
  async search(ctx: RequestCtx, eventId: string, functionId: string, q: string) {
    await this.scope.fn(ctx, eventId, functionId);
    const rows = await this.db.query<any>(
      `SELECT i.id, i.invited_party_size, i.revoked_at, g.display_name, right(g.phone_e164, 4) AS last4, gg.label AS grp,
              r.status AS rsvp_status, r.adult_count, r.child_count, c.id AS checkin_id, c.adults_present, c.children_present, c.checked_in_at
         FROM event_invitations i JOIN guests g ON g.id=i.guest_id AND g.deleted_at IS NULL LEFT JOIN guest_groups gg ON gg.id=g.guest_group_id
         LEFT JOIN rsvp_responses r ON r.invitation_id=i.id LEFT JOIN check_ins c ON c.invitation_id=i.id AND c.event_function_id=i.event_function_id AND c.voided_at IS NULL
        WHERE i.workspace_id=$1 AND i.event_function_id=$2 AND lower(g.display_name) LIKE $3 ORDER BY g.display_name LIMIT 25`,
      [ctx.workspace!.id, functionId, `%${q.toLowerCase()}%`],
    );
    return {
      data: rows.map((r) => ({
        invitationId: r.id,
        guestName: r.display_name,
        phoneLast4: r.last4,
        group: r.grp,
        partySize: r.invited_party_size,
        revoked: !!r.revoked_at,
        rsvp: r.rsvp_status ? { status: r.rsvp_status, adults: r.adult_count, children: r.child_count } : null,
        checkedIn: r.checkin_id ? { id: r.checkin_id, adults: r.adults_present, children: r.children_present, at: r.checked_in_at } : null,
      })),
    };
  }

  async checkIn(ctx: RequestCtx, eventId: string, functionId: string, key: string | undefined, i: z.infer<typeof checkInSchema>) {
    const { fn } = await this.scope.fn(ctx, eventId, functionId);
    if (['cancelled'].includes(fn.status)) throw new ApiError(409, 'FUNCTION_CLOSED', 'This function is cancelled');
    return this.idem.run(
      { scope: `${ctx.workspace!.id}|${ctx.user!.id}`, operation: `checkin:${functionId}`, key, request: i },
      async (q) => {
        const inv = i.code
          ? await q.one<any>(`SELECT * FROM event_invitations WHERE checkin_code_hash=$1 AND event_function_id=$2 AND workspace_id=$3`, [
              this.tokens.hash(i.code),
              functionId,
              ctx.workspace!.id,
            ])
          : await q.one<any>(`SELECT * FROM event_invitations WHERE id=$1 AND event_function_id=$2 AND workspace_id=$3`, [
              i.invitationId,
              functionId,
              ctx.workspace!.id,
            ]);
        // A code for another function/workspace looks exactly like an unknown code.
        if (!inv) throw notFound('Invitation');
        if (inv.revoked_at) throw new ApiError(409, 'INVITATION_REVOKED', 'This invitation has been revoked');
        await q.query(`SELECT 1 FROM event_invitations WHERE id=$1 FOR UPDATE`, [inv.id]);
        const existing = await q.one<any>(`SELECT * FROM check_ins WHERE invitation_id=$1 AND event_function_id=$2 AND voided_at IS NULL`, [
          inv.id,
          functionId,
        ]);
        if (existing) return { status: 200, body: { duplicate: true, checkIn: dto(existing) } };

        const r = await q.one<any>(`SELECT status, adult_count, child_count FROM rsvp_responses WHERE invitation_id=$1`, [inv.id]);
        let adults = i.adults,
          children = i.children;
        if (r?.status === 'yes') {
          adults ??= r.adult_count;
          children ??= r.child_count;
        } else {
          if (!i.allowUnconfirmed)
            throw new ApiError(
              409,
              'RSVP_NOT_CONFIRMED',
              'This guest has not confirmed Yes. Confirm to check them in anyway.',
              [],
              {},
              { rsvpStatus: r?.status ?? null },
            );
          if (adults === undefined && children === undefined) throw unprocessable('COUNT_REQUIRED', 'Enter how many people arrived');
          adults ??= 0;
          children ??= 0;
        }
        if (adults! + children! < 1) throw unprocessable('COUNT_REQUIRED', 'At least one person must be checked in');
        if (adults! + children! > inv.invited_party_size)
          throw unprocessable(
            'PARTY_SIZE_EXCEEDED',
            `This invitation covers up to ${inv.invited_party_size} people. Ask the organizer to correct the RSVP first.`,
          );
        try {
          const c = await q.one<any>(
            `INSERT INTO check_ins (workspace_id,event_function_id,invitation_id,checked_in_by,adults_present,children_present,method,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [ctx.workspace!.id, functionId, inv.id, ctx.user!.id, adults, children, i.code ? 'qr' : 'manual', i.note ?? null],
          );
          await this.audit.log(q, ctx, {
            workspaceId: ctx.workspace!.id,
            action: 'checkin.recorded',
            resourceType: 'invitation',
            resourceId: inv.id,
            metadata: { method: c.method, people: adults! + children!, unconfirmed: r?.status !== 'yes' },
          });
          await this.analytics.track(q, 'checkin_recorded', { workspaceId: ctx.workspace!.id, eventId, props: { method: c.method } });
          return { status: 201, body: { duplicate: false, checkIn: dto(c) } };
        } catch (e) {
          if (isUniqueViolation(e))
            throw new ApiError(409, 'CHECKIN_RACE', 'Another device just checked this guest in. Refresh and try again.');
          throw e;
        }
      },
    );
  }

  async void(ctx: RequestCtx, eventId: string, functionId: string, checkInId: string, reason: string) {
    await this.scope.fn(ctx, eventId, functionId);
    return this.db.tx(async (q) => {
      const c = await q.one<any>(
        `UPDATE check_ins SET voided_at=now(), voided_by=$4, void_reason=$5 WHERE id=$1 AND event_function_id=$2 AND workspace_id=$3 AND voided_at IS NULL RETURNING *`,
        [checkInId, functionId, ctx.workspace!.id, ctx.user!.id, reason],
      );
      if (!c) throw notFound('Check-in');
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'checkin.voided',
        resourceType: 'invitation',
        resourceId: c.invitation_id,
        reason,
      });
      return { id: c.id, voided: true };
    });
  }

  /** RSVP vs actual attendance. Labelled partial until the function is marked completed. */
  async reconciliation(ctx: RequestCtx, eventId: string, functionId: string) {
    if (!can(ctx.workspace!.role, 'checkin:read') && !can(ctx.workspace!.role, 'dashboard:read')) throw forbidden();
    const { fn } = await this.scope.fn(ctx, eventId, functionId);
    const r = await this.db.one<any>(
      `SELECT COALESCE(sum(r.adult_count + r.child_count) FILTER (WHERE r.status='yes' AND i.revoked_at IS NULL),0)::int AS yes_people,
              COALESCE(sum(c.adults_present + c.children_present),0)::int AS present_people,
              COALESCE(sum(c.adults_present),0)::int AS present_adults, COALESCE(sum(c.children_present),0)::int AS present_children,
              COALESCE(sum(c.adults_present + c.children_present) FILTER (WHERE COALESCE(r.status,'none') <> 'yes'),0)::int AS present_unconfirmed,
              count(c.id)::int AS checkins,
              COALESCE(sum(r.adult_count + r.child_count) FILTER (WHERE r.status='yes' AND i.revoked_at IS NULL AND c.id IS NULL),0)::int AS yes_not_arrived
         FROM event_invitations i LEFT JOIN rsvp_responses r ON r.invitation_id=i.id LEFT JOIN check_ins c ON c.invitation_id=i.id AND c.event_function_id=i.event_function_id AND c.voided_at IS NULL
        WHERE i.event_function_id=$1 AND i.workspace_id=$2`,
      [functionId, ctx.workspace!.id],
    );
    const complete = fn.status === 'completed';
    return {
      functionId,
      partial: !complete,
      label: complete ? 'Final reconciliation' : 'Partial: check-in is still open. Numbers will change.',
      rsvpYesPeople: r.yes_people,
      checkedInPeople: r.present_people,
      checkedInAdults: r.present_adults,
      checkedInChildren: r.present_children,
      checkedInInvitations: r.checkins,
      yesNotYetArrived: r.yes_not_arrived,
      arrivedWithoutYes: r.present_unconfirmed,
      attendanceRatePercent: r.yes_people ? Math.round(((r.present_people - r.present_unconfirmed) / r.yes_people) * 100) : 0,
    };
  }
}
