import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../common/db.service';
import { ApiError, unprocessable } from '../common/errors';
import { ScopeService, EventRow, FunctionRow } from '../common/scope.service';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { isValidTimezone, parseEventTime, toEventLocal } from '../common/time';
import type { RequestCtx } from '../common/request';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const EVENT_STATUSES = ['draft', 'active', 'completed', 'cancelled', 'archived'] as const;
export const FUNCTION_STATUSES = ['draft', 'active', 'cancelled', 'completed'] as const;

export const createEventSchema = z.object({
  name: z.string().trim().min(1).max(160),
  timezone: z.string().trim().default('Asia/Kolkata'),
  startDate: date.nullish(),
  endDate: date.nullish(),
  hostName: z.string().trim().max(160).nullish(),
});
export const updateEventSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  timezone: z.string().trim().optional(),
  startDate: date.nullish(),
  endDate: date.nullish(),
  hostName: z.string().trim().max(160).nullish(),
  status: z.enum(EVENT_STATUSES).optional(),
});
// Update schemas are built from the default-free fields so a PATCH can never re-apply create-time defaults.
const functionFields = z.object({
  name: z.string().trim().min(1).max(120),
  startsAt: z.string().min(10),
  venue: z.string().trim().max(200).nullish(),
  capacity: z.number().int().min(0).nullish(),
  rsvpDeadline: z.string().min(10).nullish(),
  allowResponseEdits: z.boolean(),
  allowChildren: z.boolean(),
  status: z.enum(FUNCTION_STATUSES),
});
export const createFunctionSchema = functionFields.extend({
  allowResponseEdits: z.boolean().default(true),
  allowChildren: z.boolean().default(true),
  status: z.enum(FUNCTION_STATUSES).default('active'),
});
export const updateFunctionSchema = functionFields.partial();

export const eventDto = (e: EventRow, extra: Record<string, unknown> = {}) => ({
  id: e.id,
  name: e.name,
  timezone: e.timezone,
  startDate: e.start_date,
  endDate: e.end_date,
  hostName: e.host_name,
  status: e.status,
  createdAt: e.created_at,
  updatedAt: e.updated_at,
  ...extra,
});
export const functionDto = (f: FunctionRow, tz: string) => ({
  id: f.id,
  eventId: f.event_id,
  name: f.name,
  startsAt: f.starts_at,
  startsAtLocal: toEventLocal(f.starts_at, tz),
  timezone: tz,
  venue: f.venue,
  capacity: f.capacity,
  rsvpDeadline: f.rsvp_deadline,
  rsvpDeadlineLocal: toEventLocal(f.rsvp_deadline, tz),
  allowResponseEdits: f.allow_response_edits,
  allowChildren: f.allow_children,
  status: f.status,
  createdAt: f.created_at,
  updatedAt: f.updated_at,
});

@Injectable()
export class EventsService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  async list(ctx: RequestCtx, includeArchived: boolean) {
    const visible = await this.scope.visibleEventIds(ctx);
    const rows = await this.db.query<any>(
      `SELECT e.*, (SELECT count(*) FROM event_functions f WHERE f.event_id=e.id)::int AS function_count,
              (SELECT min(f.starts_at) FROM event_functions f WHERE f.event_id=e.id AND f.status<>'cancelled') AS first_function_at
         FROM events e WHERE e.workspace_id=$1 AND e.deleted_at IS NULL
          AND ($2::boolean OR e.status <> 'archived') AND ($3::uuid[] IS NULL OR e.id = ANY($3::uuid[]))
        ORDER BY COALESCE(e.start_date, e.created_at::date) DESC, e.created_at DESC`,
      [ctx.workspace!.id, includeArchived, visible],
    );
    return rows.map((e) => eventDto(e, { functionCount: e.function_count, firstFunctionAt: e.first_function_at }));
  }

  async create(ctx: RequestCtx, i: z.infer<typeof createEventSchema>) {
    if (!isValidTimezone(i.timezone))
      throw unprocessable('INVALID_TIMEZONE', 'Unknown IANA time zone', [{ field: 'timezone', message: 'Use a name like Asia/Kolkata' }]);
    if (i.startDate && i.endDate && i.endDate < i.startDate)
      throw unprocessable('INVALID_DATE_RANGE', 'End date must not be before the start date', [
        { field: 'endDate', message: 'Before start date' },
      ]);
    return this.db.tx(async (q) => {
      const e = await q.one<EventRow>(
        `INSERT INTO events (workspace_id,name,timezone,start_date,end_date,host_name,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,'active',$7) RETURNING *`,
        [ctx.workspace!.id, i.name, i.timezone, i.startDate ?? null, i.endDate ?? null, i.hostName ?? null, ctx.user!.id],
      );
      await this.audit.log(q, ctx, { workspaceId: ctx.workspace!.id, action: 'event.created', resourceType: 'event', resourceId: e!.id });
      await this.analytics.track(q, 'event_created', { workspaceId: ctx.workspace!.id, eventId: e!.id });
      return eventDto(e!);
    });
  }

  async get(ctx: RequestCtx, eventId: string) {
    const e = await this.scope.event(ctx, eventId);
    const visible = await this.scope.visibleFunctionIds(ctx, eventId);
    const fns = await this.db.query<FunctionRow>(
      `SELECT * FROM event_functions WHERE event_id=$1 AND workspace_id=$2 AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[])) ORDER BY starts_at, name`,
      [eventId, ctx.workspace!.id, visible],
    );
    return eventDto(e, { functions: fns.map((f) => functionDto(f, e.timezone)) });
  }

  async update(ctx: RequestCtx, eventId: string, i: z.infer<typeof updateEventSchema>) {
    return this.db.tx(async (q) => {
      const e = await this.scope.event(ctx, eventId, q);
      if (i.timezone && i.timezone !== e.timezone) {
        if (!isValidTimezone(i.timezone)) throw unprocessable('INVALID_TIMEZONE', 'Unknown IANA time zone');
        const n = await q.one<{ c: number }>(`SELECT count(*)::int AS c FROM event_functions WHERE event_id=$1`, [eventId]);
        if (n!.c > 0) throw unprocessable('TIMEZONE_LOCKED', 'Time zone cannot change once functions exist; create a new event instead');
      }
      const sd = i.startDate === undefined ? e.start_date : i.startDate;
      const ed = i.endDate === undefined ? e.end_date : i.endDate;
      if (sd && ed && ed < sd) throw unprocessable('INVALID_DATE_RANGE', 'End date must not be before the start date');
      const r = await q.one<EventRow>(
        `UPDATE events SET name=$3, timezone=$4, start_date=$5, end_date=$6, host_name=$7, status=$8, updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING *`,
        [
          eventId,
          ctx.workspace!.id,
          i.name ?? e.name,
          i.timezone ?? e.timezone,
          sd,
          ed,
          i.hostName === undefined ? e.host_name : i.hostName,
          i.status ?? e.status,
        ],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: i.status && i.status !== e.status ? `event.status_${i.status}` : 'event.updated',
        resourceType: 'event',
        resourceId: eventId,
      });
      return eventDto(r!);
    });
  }

  // ---- functions ----
  private resolveTimes(tz: string, startsAt?: string, rsvpDeadline?: string | null) {
    let s: Date | undefined;
    let d: Date | null | undefined;
    if (startsAt !== undefined) {
      const p = parseEventTime(startsAt, tz);
      if (!p)
        throw unprocessable('INVALID_DATETIME', 'startsAt is not a valid date/time', [
          { field: 'startsAt', message: 'Use 2026-12-10T18:30 (event time) or an ISO instant with offset' },
        ]);
      s = p;
    }
    if (rsvpDeadline !== undefined) {
      if (rsvpDeadline === null) d = null;
      else {
        const p = parseEventTime(rsvpDeadline, tz);
        if (!p)
          throw unprocessable('INVALID_DATETIME', 'rsvpDeadline is not a valid date/time', [
            { field: 'rsvpDeadline', message: 'Invalid date/time' },
          ]);
        d = p;
      }
    }
    return { s, d };
  }

  async createFunction(ctx: RequestCtx, eventId: string, i: z.infer<typeof createFunctionSchema>) {
    return this.db.tx(async (q) => {
      const e = await this.scope.event(ctx, eventId, q);
      const { s, d } = this.resolveTimes(e.timezone, i.startsAt, i.rsvpDeadline ?? null);
      if (d && s && d > s)
        throw unprocessable('INVALID_DEADLINE', 'RSVP deadline must not be after the function start', [
          { field: 'rsvpDeadline', message: 'After start time' },
        ]);
      try {
        const f = await q.one<FunctionRow>(
          `INSERT INTO event_functions (workspace_id,event_id,name,starts_at,venue,capacity,rsvp_deadline,allow_response_edits,allow_children,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            ctx.workspace!.id,
            eventId,
            i.name,
            s,
            i.venue ?? null,
            i.capacity ?? null,
            d ?? null,
            i.allowResponseEdits,
            i.allowChildren,
            i.status,
          ],
        );
        await this.audit.log(q, ctx, {
          workspaceId: ctx.workspace!.id,
          action: 'function.created',
          resourceType: 'function',
          resourceId: f!.id,
        });
        return functionDto(f!, e.timezone);
      } catch (err: any) {
        if (err?.code === '23505') throw new ApiError(409, 'FUNCTION_NAME_TAKEN', 'This event already has a function with that name');
        throw err;
      }
    });
  }

  async getFunction(ctx: RequestCtx, eventId: string, functionId: string) {
    const { event, fn } = await this.scope.fn(ctx, eventId, functionId);
    return functionDto(fn, event.timezone);
  }

  async updateFunction(ctx: RequestCtx, eventId: string, functionId: string, i: z.infer<typeof updateFunctionSchema>) {
    return this.db.tx(async (q) => {
      const { event, fn } = await this.scope.fn(ctx, eventId, functionId, q);
      const { s, d } = this.resolveTimes(event.timezone, i.startsAt, i.rsvpDeadline);
      const starts = s ?? fn.starts_at;
      const deadline = d === undefined ? fn.rsvp_deadline : d;
      if (deadline && deadline > starts) throw unprocessable('INVALID_DEADLINE', 'RSVP deadline must not be after the function start');
      try {
        const r = await q.one<FunctionRow>(
          `UPDATE event_functions SET name=$3, starts_at=$4, venue=$5, capacity=$6, rsvp_deadline=$7, allow_response_edits=$8, allow_children=$9, status=$10, updated_at=now()
            WHERE id=$1 AND workspace_id=$2 RETURNING *`,
          [
            functionId,
            ctx.workspace!.id,
            i.name ?? fn.name,
            starts,
            i.venue === undefined ? fn.venue : i.venue,
            i.capacity === undefined ? fn.capacity : i.capacity,
            deadline,
            i.allowResponseEdits ?? fn.allow_response_edits,
            i.allowChildren ?? fn.allow_children,
            i.status ?? fn.status,
          ],
        );
        await this.audit.log(q, ctx, {
          workspaceId: ctx.workspace!.id,
          action: i.status && i.status !== fn.status ? `function.status_${i.status}` : 'function.updated',
          resourceType: 'function',
          resourceId: functionId,
        });
        return functionDto(r!, event.timezone);
      } catch (err: any) {
        if (err?.code === '23505') throw new ApiError(409, 'FUNCTION_NAME_TAKEN', 'This event already has a function with that name');
        throw err;
      }
    });
  }
}
