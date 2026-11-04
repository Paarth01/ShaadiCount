import { Injectable } from '@nestjs/common';
import { DbService, Q } from './db.service';
import { notFound } from './errors';
import type { RequestCtx } from './request';
import { SCOPED_ROLES } from '../auth/permissions';

export interface EventRow {
  id: string;
  workspace_id: string;
  name: string;
  timezone: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  host_name: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface FunctionRow {
  id: string;
  workspace_id: string;
  event_id: string;
  name: string;
  starts_at: Date;
  venue: string | null;
  capacity: number | null;
  rsvp_deadline: Date | null;
  allow_response_edits: boolean;
  allow_children: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Resource-level authorization. Every lookup is constrained by the workspace the guard already authorised, and
 * scoped roles (planner / checkin_staff / readonly / caterer) additionally need an assignment covering the resource.
 * Missing and not-permitted resources are both reported as 404 so IDs cannot be probed.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly db: DbService) {}

  private isScoped(ctx: RequestCtx) {
    return SCOPED_ROLES.has(ctx.workspace!.role);
  }

  async event(ctx: RequestCtx, eventId: string, q: Q = this.db): Promise<EventRow> {
    const ev = await q.one<EventRow>(`SELECT * FROM events WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [
      eventId,
      ctx.workspace!.id,
    ]);
    if (!ev) throw notFound('Event');
    if (this.isScoped(ctx)) {
      const a = await q.one(`SELECT 1 FROM member_assignments WHERE workspace_id=$1 AND user_id=$2 AND event_id=$3 LIMIT 1`, [
        ctx.workspace!.id,
        ctx.user!.id,
        eventId,
      ]);
      if (!a) throw notFound('Event');
    }
    return ev;
  }

  async fn(ctx: RequestCtx, eventId: string, functionId: string, q: Q = this.db): Promise<{ event: EventRow; fn: FunctionRow }> {
    const event = await this.event(ctx, eventId, q);
    const fn = await q.one<FunctionRow>(`SELECT * FROM event_functions WHERE id=$1 AND event_id=$2 AND workspace_id=$3`, [
      functionId,
      eventId,
      ctx.workspace!.id,
    ]);
    if (!fn) throw notFound('Function');
    if (this.isScoped(ctx)) {
      const a = await q.one(
        `SELECT 1 FROM member_assignments WHERE workspace_id=$1 AND user_id=$2 AND event_id=$3 AND (function_id IS NULL OR function_id=$4) LIMIT 1`,
        [ctx.workspace!.id, ctx.user!.id, eventId, functionId],
      );
      if (!a) throw notFound('Function');
    }
    return { event, fn };
  }

  /** Event ids visible to the caller, or null for "all in workspace". */
  async visibleEventIds(ctx: RequestCtx): Promise<string[] | null> {
    if (!this.isScoped(ctx)) return null;
    const rows = await this.db.query<{ event_id: string }>(
      `SELECT DISTINCT event_id FROM member_assignments WHERE workspace_id=$1 AND user_id=$2`,
      [ctx.workspace!.id, ctx.user!.id],
    );
    return rows.map((r) => r.event_id);
  }

  /** Function ids visible within an event (null = all). */
  async visibleFunctionIds(ctx: RequestCtx, eventId: string): Promise<string[] | null> {
    if (!this.isScoped(ctx)) return null;
    const rows = await this.db.query<{ function_id: string | null }>(
      `SELECT function_id FROM member_assignments WHERE workspace_id=$1 AND user_id=$2 AND event_id=$3`,
      [ctx.workspace!.id, ctx.user!.id, eventId],
    );
    if (rows.some((r) => r.function_id === null)) return null;
    return rows.map((r) => r.function_id!);
  }
}
