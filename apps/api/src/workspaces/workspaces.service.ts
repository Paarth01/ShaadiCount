import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../common/db.service';
import { ApiError, notFound, unprocessable } from '../common/errors';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { CONFIG, Config } from '../config/config';
import { ROLES } from '../auth/permissions';
import type { RequestCtx } from '../common/request';

export const createWorkspaceSchema = z.object({ name: z.string().trim().min(1).max(160) });
export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
  messageSpendCapPaise: z.number().int().min(0).nullable().optional(),
});
export const addMemberSchema = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ROLES) });
export const updateMemberSchema = z.object({ role: z.enum(ROLES) });
export const assignmentsSchema = z.object({
  eventIds: z.array(z.string().uuid()).max(200).default([]),
  functionIds: z.array(z.string().uuid()).max(500).default([]),
});

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  list(userId: string) {
    return this.db.query(
      `SELECT w.id, w.name, m.role, w.created_at AS "createdAt" FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
        WHERE m.user_id=$1 AND w.deleted_at IS NULL ORDER BY w.created_at`,
      [userId],
    );
  }

  async create(ctx: RequestCtx, name: string) {
    return this.db.tx(async (q) => {
      const w = await q.one<{ id: string }>(`INSERT INTO workspaces (name, created_by) VALUES ($1,$2) RETURNING id`, [name, ctx.user!.id]);
      await q.query(`INSERT INTO workspace_members (workspace_id, user_id, role, created_by) VALUES ($1,$2,'owner',$2)`, [
        w!.id,
        ctx.user!.id,
      ]);
      await this.audit.log(q, ctx, { workspaceId: w!.id, action: 'workspace.created', resourceType: 'workspace', resourceId: w!.id });
      await this.analytics.track(q, 'workspace_created', { workspaceId: w!.id });
      return { id: w!.id, name, role: 'owner' };
    });
  }

  async get(ctx: RequestCtx) {
    const w = await this.db.one<any>(
      `SELECT id, name, contact_authority_attested_at AS "contactAuthorityAttestedAt", message_spend_cap_paise AS "messageSpendCapPaise",
              quiet_hours_start AS "quietHoursStart", quiet_hours_end AS "quietHoursEnd", created_at AS "createdAt"
         FROM workspaces WHERE id=$1 AND deleted_at IS NULL`,
      [ctx.workspace!.id],
    );
    if (!w) throw notFound('Workspace');
    return {
      ...w,
      role: ctx.workspace!.role,
      messaging: {
        mode: this.cfg.MESSAGING_MODE,
        liveEnabled: this.cfg.LIVE_MESSAGING_ENABLED,
        enabledChannels: this.cfg.ENABLED_CHANNELS,
      },
    };
  }

  async update(ctx: RequestCtx, input: z.infer<typeof updateWorkspaceSchema>) {
    const cur = await this.get(ctx);
    const name = input.name ?? cur.name;
    const qs = input.quietHoursStart ?? cur.quietHoursStart;
    const qe = input.quietHoursEnd ?? cur.quietHoursEnd;
    const cap = input.messageSpendCapPaise === undefined ? cur.messageSpendCapPaise : input.messageSpendCapPaise;
    await this.db.tx(async (q) => {
      await q.query(`UPDATE workspaces SET name=$2, quiet_hours_start=$3, quiet_hours_end=$4, message_spend_cap_paise=$5 WHERE id=$1`, [
        ctx.workspace!.id,
        name,
        qs,
        qe,
        cap,
      ]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'workspace.updated',
        resourceType: 'workspace',
        resourceId: ctx.workspace!.id,
        metadata: { fields: Object.keys(input) },
      });
    });
    return this.get(ctx);
  }

  async attestContactAuthority(ctx: RequestCtx) {
    await this.db.tx(async (q) => {
      await q.query(`UPDATE workspaces SET contact_authority_attested_at=now(), contact_authority_attested_by=$2 WHERE id=$1`, [
        ctx.workspace!.id,
        ctx.user!.id,
      ]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'workspace.contact_authority_attested',
        resourceType: 'workspace',
        resourceId: ctx.workspace!.id,
      });
    });
    return this.get(ctx);
  }

  // ---- members ----
  members(ctx: RequestCtx) {
    return this.db.query(
      `SELECT u.id AS "userId", u.display_name AS "displayName", u.email, m.role, m.created_at AS "createdAt",
              COALESCE((SELECT json_agg(json_build_object('eventId', a.event_id, 'functionId', a.function_id)) FROM member_assignments a
                         WHERE a.workspace_id=m.workspace_id AND a.user_id=m.user_id), '[]'::json) AS assignments
         FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.created_at`,
      [ctx.workspace!.id],
    );
  }

  async addMember(ctx: RequestCtx, input: z.infer<typeof addMemberSchema>) {
    return this.db.tx(async (q) => {
      const u = await q.one<{ id: string }>(`SELECT id FROM users WHERE lower(email)=$1 AND disabled_at IS NULL`, [input.email]);
      // Assumption: collaborators must already have registered (no invitation e-mails in the MVP).
      if (!u) throw unprocessable('USER_NOT_REGISTERED', 'That person has not registered yet. Ask them to create an account first.');
      const ex = await q.one(`SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [ctx.workspace!.id, u.id]);
      if (ex) throw new ApiError(409, 'ALREADY_MEMBER', 'This person is already a member of the workspace');
      await q.query(`INSERT INTO workspace_members (workspace_id, user_id, role, created_by) VALUES ($1,$2,$3,$4)`, [
        ctx.workspace!.id,
        u.id,
        input.role,
        ctx.user!.id,
      ]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'member.added',
        resourceType: 'user',
        resourceId: u.id,
        metadata: { role: input.role },
      });
      return { userId: u.id, role: input.role };
    });
  }

  private async assertNotLastOwner(q: any, workspaceId: string, userId: string) {
    const owners = await q.query(`SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND role='owner' FOR UPDATE`, [workspaceId]);
    if (owners.length === 1 && owners[0].user_id === userId) throw unprocessable('LAST_OWNER', 'A workspace must keep at least one owner');
  }

  async updateMember(ctx: RequestCtx, userId: string, role: (typeof ROLES)[number]) {
    return this.db.tx(async (q) => {
      const cur = await q.one<{ role: string }>(`SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [
        ctx.workspace!.id,
        userId,
      ]);
      if (!cur) throw notFound('Member');
      if (cur.role === 'owner' && role !== 'owner') await this.assertNotLastOwner(q, ctx.workspace!.id, userId);
      await q.query(`UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2`, [ctx.workspace!.id, userId, role]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'member.role_changed',
        resourceType: 'user',
        resourceId: userId,
        metadata: { from: cur.role, to: role },
      });
      return { userId, role };
    });
  }

  async removeMember(ctx: RequestCtx, userId: string) {
    await this.db.tx(async (q) => {
      const cur = await q.one<{ role: string }>(`SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [
        ctx.workspace!.id,
        userId,
      ]);
      if (!cur) throw notFound('Member');
      if (cur.role === 'owner') await this.assertNotLastOwner(q, ctx.workspace!.id, userId);
      await q.query(`DELETE FROM member_assignments WHERE workspace_id=$1 AND user_id=$2`, [ctx.workspace!.id, userId]);
      await q.query(`DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [ctx.workspace!.id, userId]);
      await this.audit.log(q, ctx, { workspaceId: ctx.workspace!.id, action: 'member.removed', resourceType: 'user', resourceId: userId });
    });
  }

  /** Replaces the member's event/function assignments. Every id is verified to belong to this workspace. */
  async setAssignments(ctx: RequestCtx, userId: string, input: z.infer<typeof assignmentsSchema>) {
    return this.db.tx(async (q) => {
      const m = await q.one(`SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [ctx.workspace!.id, userId]);
      if (!m) throw notFound('Member');
      await q.query(`DELETE FROM member_assignments WHERE workspace_id=$1 AND user_id=$2`, [ctx.workspace!.id, userId]);
      for (const eventId of input.eventIds) {
        const ev = await q.one(`SELECT 1 FROM events WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, [eventId, ctx.workspace!.id]);
        if (!ev) throw unprocessable('INVALID_ASSIGNMENT', 'Unknown event in assignment list');
        await q.query(`INSERT INTO member_assignments (workspace_id,user_id,event_id,created_by) VALUES ($1,$2,$3,$4)`, [
          ctx.workspace!.id,
          userId,
          eventId,
          ctx.user!.id,
        ]);
      }
      for (const functionId of input.functionIds) {
        const f = await q.one<{ event_id: string }>(`SELECT event_id FROM event_functions WHERE id=$1 AND workspace_id=$2`, [
          functionId,
          ctx.workspace!.id,
        ]);
        if (!f) throw unprocessable('INVALID_ASSIGNMENT', 'Unknown function in assignment list');
        await q.query(`INSERT INTO member_assignments (workspace_id,user_id,event_id,function_id,created_by) VALUES ($1,$2,$3,$4,$5)`, [
          ctx.workspace!.id,
          userId,
          f.event_id,
          functionId,
          ctx.user!.id,
        ]);
      }
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'member.assignments_set',
        resourceType: 'user',
        resourceId: userId,
        metadata: { events: input.eventIds.length, functions: input.functionIds.length },
      });
      return { userId, eventIds: input.eventIds, functionIds: input.functionIds };
    });
  }

  async usage(ctx: RequestCtx) {
    const r = await this.db.one<any>(
      `SELECT (SELECT count(*) FROM events WHERE workspace_id=$1 AND deleted_at IS NULL)::int AS events,
              (SELECT count(*) FROM guests WHERE workspace_id=$1 AND deleted_at IS NULL)::int AS guests,
              (SELECT count(*) FROM event_invitations WHERE workspace_id=$1)::int AS invitations,
              (SELECT count(*) FROM scheduled_messages WHERE workspace_id=$1 AND status IN ('submitted','delivered','read'))::int AS "messagesSubmitted",
              (SELECT COALESCE(sum(estimated_cost_paise),0) FROM scheduled_messages WHERE workspace_id=$1 AND status IN ('submitted','delivered','read'))::bigint AS "estimatedSpendPaise"`,
      [ctx.workspace!.id],
    );
    return { ...r, note: 'Usage counters only. Billing and subscriptions are outside the MVP.' };
  }
}
