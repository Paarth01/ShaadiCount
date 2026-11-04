import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { DbService, Q } from '../common/db.service';
import { ApiError, notFound, unprocessable } from '../common/errors';
import { ScopeService, FunctionRow } from '../common/scope.service';
import { AuditService } from '../audit/audit.service';
import { maskPhone } from '../common/phone';
import { TokensService } from './tokens.service';
import type { RequestCtx } from '../common/request';

export const createInvitationsSchema = z.object({
  invites: z
    .array(z.object({ guestId: z.string().uuid(), partySize: z.number().int().min(1).max(50).default(1) }))
    .min(1)
    .max(500),
});
export const updateInvitationSchema = z.object({ partySize: z.number().int().min(1).max(50) });
export const reasonSchema = z.object({ reason: z.string().trim().max(300).optional() });
export const listInvitationsSchema = z.object({
  status: z.enum(['all', 'pending', 'responded', 'yes', 'maybe', 'no', 'not_responded', 'revoked']).default('all'),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly tokens: TokensService,
  ) {}

  /** Creates invitations inside the caller's transaction. Existing (guest, function) pairs are skipped and reported. */
  async createInTx(q: Q, workspaceId: string, fn: Pick<FunctionRow, 'id' | 'event_id'>, invites: { guestId: string; partySize: number }[]) {
    const created: string[] = [];
    const existing: string[] = [];
    for (const inv of invites) {
      const id = randomUUID();
      const { tokenHash, checkinHash } = this.tokens.hashes(id, 1);
      const r = await q.one<{ id: string }>(
        `INSERT INTO event_invitations (id, workspace_id, event_id, event_function_id, guest_id, invited_party_size, token_hash, checkin_code_hash)
         SELECT $1,$2,$3,$4,g.id,$6,$7,$8 FROM guests g WHERE g.id=$5 AND g.workspace_id=$2 AND g.event_id=$3 AND g.deleted_at IS NULL
         ON CONFLICT (event_function_id, guest_id) DO NOTHING RETURNING id`,
        [id, workspaceId, fn.event_id, fn.id, inv.guestId, inv.partySize, tokenHash, checkinHash],
      );
      if (r) created.push(r.id);
      else {
        const g = await q.one(`SELECT 1 FROM guests WHERE id=$1 AND workspace_id=$2 AND event_id=$3 AND deleted_at IS NULL`, [
          inv.guestId,
          workspaceId,
          fn.event_id,
        ]);
        if (!g) throw unprocessable('UNKNOWN_GUEST', 'One or more guests do not belong to this event');
        existing.push(inv.guestId);
      }
    }
    return { created, alreadyInvited: existing };
  }

  async create(ctx: RequestCtx, eventId: string, functionId: string, input: z.infer<typeof createInvitationsSchema>) {
    return this.db.tx(async (q) => {
      const { fn } = await this.scope.fn(ctx, eventId, functionId, q);
      const r = await this.createInTx(q, ctx.workspace!.id, fn, input.invites);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'invitations.created',
        resourceType: 'function',
        resourceId: functionId,
        metadata: { created: r.created.length, skipped: r.alreadyInvited.length },
      });
      return { createdCount: r.created.length, alreadyInvitedGuestIds: r.alreadyInvited, invitationIds: r.created };
    });
  }

  async list(ctx: RequestCtx, eventId: string, functionId: string, f: z.infer<typeof listInvitationsSchema>) {
    await this.scope.fn(ctx, eventId, functionId);
    const params: unknown[] = [ctx.workspace!.id, functionId];
    let where = 'i.workspace_id=$1 AND i.event_function_id=$2 AND g.deleted_at IS NULL';
    if (f.search) {
      params.push(`%${f.search.toLowerCase()}%`);
      where += ` AND lower(g.display_name) LIKE $${params.length}`;
    }
    switch (f.status) {
      case 'pending':
        where += ` AND r.id IS NULL AND i.revoked_at IS NULL`;
        break;
      case 'not_responded':
        where += ` AND r.id IS NULL AND i.revoked_at IS NULL`;
        break;
      case 'responded':
        where += ` AND r.id IS NOT NULL`;
        break;
      case 'yes':
      case 'maybe':
      case 'no':
        params.push(f.status);
        where += ` AND r.status=$${params.length}`;
        break;
      case 'revoked':
        where += ` AND i.revoked_at IS NOT NULL`;
        break;
    }
    const total = (await this.db.one<{ c: number }>(
      `SELECT count(*)::int AS c FROM event_invitations i JOIN guests g ON g.id=i.guest_id LEFT JOIN rsvp_responses r ON r.invitation_id=i.id WHERE ${where}`,
      params,
    ))!.c;
    params.push(f.limit, (f.page - 1) * f.limit);
    const rows = await this.db.query<any>(
      `SELECT i.id, i.guest_id, i.invited_party_size, i.status, i.revoked_at, i.created_at, g.display_name, g.phone_e164, gg.label AS group_label, g.preferred_language,
              r.status AS rsvp_status, r.adult_count, r.child_count, r.version AS rsvp_version, r.responded_at, r.last_actor_type,
              c.id AS checkin_id, c.adults_present, c.children_present,
              (SELECT m.status FROM scheduled_messages m WHERE m.invitation_id=i.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_status
         FROM event_invitations i JOIN guests g ON g.id=i.guest_id LEFT JOIN guest_groups gg ON gg.id=g.guest_group_id
         LEFT JOIN rsvp_responses r ON r.invitation_id=i.id LEFT JOIN check_ins c ON c.invitation_id=i.id AND c.event_function_id=i.event_function_id AND c.voided_at IS NULL
        WHERE ${where} ORDER BY g.display_name, i.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      data: rows.map((r) => ({
        id: r.id,
        guestId: r.guest_id,
        guestName: r.display_name,
        phoneMasked: maskPhone(r.phone_e164),
        group: r.group_label,
        language: r.preferred_language,
        partySize: r.invited_party_size,
        status: r.revoked_at ? 'revoked' : r.status,
        revokedAt: r.revoked_at,
        response: r.rsvp_status
          ? {
              status: r.rsvp_status,
              adultCount: r.adult_count,
              childCount: r.child_count,
              version: r.rsvp_version,
              respondedAt: r.responded_at,
              lastActor: r.last_actor_type,
            }
          : null,
        checkedIn: r.checkin_id ? { adults: r.adults_present, children: r.children_present } : null,
        lastMessageStatus: r.last_message_status,
      })),
      page: f.page,
      limit: f.limit,
      total,
    };
  }

  private async load(ctx: RequestCtx, eventId: string, functionId: string, invitationId: string, q: Q = this.db) {
    const { fn, event } = await this.scope.fn(ctx, eventId, functionId, q);
    const inv = await q.one<any>(`SELECT * FROM event_invitations WHERE id=$1 AND event_function_id=$2 AND workspace_id=$3`, [
      invitationId,
      functionId,
      ctx.workspace!.id,
    ]);
    if (!inv) throw notFound('Invitation');
    return { fn, event, inv };
  }

  async update(ctx: RequestCtx, eventId: string, functionId: string, invitationId: string, input: z.infer<typeof updateInvitationSchema>) {
    return this.db.tx(async (q) => {
      const { inv } = await this.load(ctx, eventId, functionId, invitationId, q);
      const r = await q.one<{ adult_count: number; child_count: number }>(
        `SELECT adult_count, child_count FROM rsvp_responses WHERE invitation_id=$1`,
        [invitationId],
      );
      if (r && r.adult_count + r.child_count > input.partySize)
        throw unprocessable('PARTY_SIZE_BELOW_RESPONSE', 'The guest has already responded for more people. Correct the RSVP first.');
      await q.query(`UPDATE event_invitations SET invited_party_size=$2, updated_at=now() WHERE id=$1`, [inv.id, input.partySize]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'invitation.party_size_changed',
        resourceType: 'invitation',
        resourceId: inv.id,
        metadata: { from: inv.invited_party_size, to: input.partySize },
      });
      return { id: inv.id, partySize: input.partySize };
    });
  }

  async revoke(ctx: RequestCtx, eventId: string, functionId: string, invitationId: string, reason?: string) {
    return this.db.tx(async (q) => {
      const { inv } = await this.load(ctx, eventId, functionId, invitationId, q);
      await q.query(`UPDATE event_invitations SET revoked_at=COALESCE(revoked_at, now()), status='revoked', updated_at=now() WHERE id=$1`, [
        inv.id,
      ]);
      await q.query(
        `UPDATE scheduled_messages SET status='cancelled', skip_reason='invitation_revoked', locked_until=NULL, updated_at=now() WHERE invitation_id=$1 AND status IN ('scheduled','queued')`,
        [inv.id],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'invitation.revoked',
        resourceType: 'invitation',
        resourceId: inv.id,
        reason,
      });
      return { id: inv.id, status: 'revoked' };
    });
  }

  async restore(ctx: RequestCtx, eventId: string, functionId: string, invitationId: string) {
    return this.db.tx(async (q) => {
      const { inv } = await this.load(ctx, eventId, functionId, invitationId, q);
      const hasResp = await q.one(`SELECT 1 FROM rsvp_responses WHERE invitation_id=$1`, [inv.id]);
      await q.query(`UPDATE event_invitations SET revoked_at=NULL, status=$2, updated_at=now() WHERE id=$1`, [
        inv.id,
        hasResp ? 'responded' : 'pending',
      ]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'invitation.restored',
        resourceType: 'invitation',
        resourceId: inv.id,
      });
      return { id: inv.id, status: hasResp ? 'responded' : 'pending' };
    });
  }

  /** Rotation invalidates the previous link and QR code immediately; the new link is returned once to the caller. */
  async rotate(ctx: RequestCtx, eventId: string, functionId: string, invitationId: string, reason?: string) {
    return this.db.tx(async (q) => {
      const { inv } = await this.load(ctx, eventId, functionId, invitationId, q);
      const version = inv.token_version + 1;
      const { tokenHash, checkinHash } = this.tokens.hashes(inv.id, version);
      await q.query(`UPDATE event_invitations SET token_version=$2, token_hash=$3, checkin_code_hash=$4, updated_at=now() WHERE id=$1`, [
        inv.id,
        version,
        tokenHash,
        checkinHash,
      ]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'invitation.token_rotated',
        resourceType: 'invitation',
        resourceId: inv.id,
        reason,
      });
      return { id: inv.id, link: this.tokens.link(inv.id, version) };
    });
  }

  async link(ctx: RequestCtx, eventId: string, functionId: string, invitationId: string) {
    const { inv } = await this.load(ctx, eventId, functionId, invitationId);
    if (inv.revoked_at) throw new ApiError(409, 'INVITATION_REVOKED', 'This invitation has been revoked');
    return { id: inv.id, link: this.tokens.link(inv.id, inv.token_version) };
  }

  async history(ctx: RequestCtx, eventId: string, functionId: string, invitationId: string) {
    await this.load(ctx, eventId, functionId, invitationId);
    const rows = await this.db.query<any>(
      `SELECT h.response_version, h.previous_status, h.new_status, h.previous_adult_count, h.previous_child_count, h.new_adult_count, h.new_child_count,
              h.actor_type, u.display_name AS actor_name, h.reason, h.is_override, h.created_at
         FROM rsvp_response_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.invitation_id=$1 AND h.workspace_id=$2 ORDER BY h.created_at, h.response_version`,
      [invitationId, ctx.workspace!.id],
    );
    return {
      data: rows.map((h) => ({
        version: h.response_version,
        previousStatus: h.previous_status,
        newStatus: h.new_status,
        previousCounts: h.previous_status ? { adults: h.previous_adult_count, children: h.previous_child_count } : null,
        newCounts: { adults: h.new_adult_count, children: h.new_child_count },
        actorType: h.actor_type,
        actorName: h.actor_name,
        reason: h.reason,
        isOverride: h.is_override,
        at: h.created_at,
      })),
    };
  }
}
