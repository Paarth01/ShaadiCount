import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, Q } from '../common/db.service';
import { ApiError, forbidden, notFound, unprocessable } from '../common/errors';
import { ScopeService } from '../common/scope.service';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { maskPhone } from '../common/phone';
import { toCsv } from '../common/csv';
import { addDays } from '../common/time';
import { can, Permission } from '../auth/permissions';
import { calculateCatering } from './catering';
import { CONFIG, Config } from '../config/config';
import type { RequestCtx } from '../common/request';

export const cateringSettingsSchema = z.object({
  maybeWeightPercent: z.number().min(0).max(100).optional(),
  pendingWeightPercent: z.number().min(0).max(100).optional(),
  bufferPercent: z.number().min(0).max(100).optional(),
  mealRounding: z.number().int().min(1).max(100).optional(),
  adultPricePaise: z.number().int().min(0).nullable().optional(),
  childPricePaise: z.number().int().min(0).nullable().optional(),
});
export const snapshotSchema = z.object({ label: z.string().trim().max(120).optional() });
export const exportSchema = z.object({
  kind: z.enum(['guests', 'rsvps', 'catering', 'checkins']),
  functionId: z.string().uuid().optional(),
});
export const nonRespondersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Injectable()
export class ReportingService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  // ---------- RSVP dashboard ----------
  async functionSummary(workspaceId: string, functionId: string, q: Q = this.db) {
    const r = await q.one<any>(
      `SELECT count(*) FILTER (WHERE i.revoked_at IS NULL)::int AS invitations,
              COALESCE(sum(i.invited_party_size) FILTER (WHERE i.revoked_at IS NULL),0)::int AS invited_people,
              count(*) FILTER (WHERE i.revoked_at IS NULL AND r.id IS NOT NULL)::int AS responded,
              count(*) FILTER (WHERE i.revoked_at IS NULL AND r.id IS NULL)::int AS not_responded,
              COALESCE(sum(i.invited_party_size) FILTER (WHERE i.revoked_at IS NULL AND r.id IS NULL),0)::int AS pending_people,
              count(*) FILTER (WHERE i.revoked_at IS NULL AND r.status='yes')::int AS yes,
              count(*) FILTER (WHERE i.revoked_at IS NULL AND r.status='maybe')::int AS maybe,
              count(*) FILTER (WHERE i.revoked_at IS NULL AND r.status='no')::int AS no,
              COALESCE(sum(r.adult_count) FILTER (WHERE i.revoked_at IS NULL AND r.status='yes'),0)::int AS yes_adults,
              COALESCE(sum(r.child_count) FILTER (WHERE i.revoked_at IS NULL AND r.status='yes'),0)::int AS yes_children,
              COALESCE(sum(r.adult_count) FILTER (WHERE i.revoked_at IS NULL AND r.status='maybe'),0)::int AS maybe_adults,
              COALESCE(sum(r.child_count) FILTER (WHERE i.revoked_at IS NULL AND r.status='maybe'),0)::int AS maybe_children,
              count(*) FILTER (WHERE i.revoked_at IS NULL AND r.status='maybe' AND r.adult_count + r.child_count = 0)::int AS maybe_without_count,
              max(r.updated_at) AS last_response_at
         FROM event_invitations i JOIN guests g ON g.id=i.guest_id AND g.deleted_at IS NULL LEFT JOIN rsvp_responses r ON r.invitation_id=i.id
        WHERE i.event_function_id=$1 AND i.workspace_id=$2`,
      [functionId, workspaceId],
    );
    const c = await q.one<any>(
      `SELECT count(*)::int AS invitations, COALESCE(sum(adults_present),0)::int AS adults, COALESCE(sum(children_present),0)::int AS children
         FROM check_ins WHERE event_function_id=$1 AND workspace_id=$2 AND voided_at IS NULL`,
      [functionId, workspaceId],
    );
    return { r, c };
  }

  async functionDashboard(ctx: RequestCtx, eventId: string, functionId: string) {
    const { fn, event } = await this.scope.fn(ctx, eventId, functionId);
    const { r, c } = await this.functionSummary(ctx.workspace!.id, functionId);
    const confirmedTotal = r.yes_adults + r.yes_children;
    return {
      functionId,
      name: fn.name,
      status: fn.status,
      startsAt: fn.starts_at,
      timezone: event.timezone,
      capacity: fn.capacity,
      rsvpDeadline: fn.rsvp_deadline,
      counts: { invitations: r.invitations, responded: r.responded, notResponded: r.not_responded, yes: r.yes, maybe: r.maybe, no: r.no },
      people: {
        confirmedAdults: r.yes_adults,
        confirmedChildren: r.yes_children,
        confirmedTotal,
        tentativeAdults: r.maybe_adults,
        tentativeChildren: r.maybe_children,
        tentativeTotal: r.maybe_adults + r.maybe_children,
        maybeWithoutCount: r.maybe_without_count,
        pendingMax: r.pending_people,
        invitedMax: r.invited_people,
      },
      responseRatePercent: r.invitations ? Math.round((r.responded / r.invitations) * 100) : 0,
      capacityStatus:
        fn.capacity === null
          ? 'unset'
          : confirmedTotal > fn.capacity
            ? 'over'
            : confirmedTotal + r.maybe_adults + r.maybe_children > fn.capacity
              ? 'at_risk'
              : 'ok',
      lastResponseAt: r.last_response_at,
      checkIn: { invitations: c.invitations, adults: c.adults, children: c.children, people: c.adults + c.children },
      generatedAt: new Date().toISOString(),
    };
  }

  async eventDashboard(ctx: RequestCtx, eventId: string) {
    const event = await this.scope.event(ctx, eventId);
    const visible = await this.scope.visibleFunctionIds(ctx, eventId);
    const fns = await this.db.query<{ id: string }>(
      `SELECT id FROM event_functions WHERE event_id=$1 AND workspace_id=$2 AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[])) ORDER BY starts_at, name`,
      [eventId, ctx.workspace!.id, visible],
    );
    const functions = [];
    for (const f of fns) functions.push(await this.functionDashboard(ctx, eventId, f.id));
    return { eventId, name: event.name, functions };
  }

  async nonResponders(ctx: RequestCtx, eventId: string, functionId: string, p: z.infer<typeof nonRespondersSchema>) {
    await this.scope.fn(ctx, eventId, functionId);
    const where = `i.event_function_id=$1 AND i.workspace_id=$2 AND i.revoked_at IS NULL AND g.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM rsvp_responses r WHERE r.invitation_id=i.id)`;
    const total = (await this.db.one<{ c: number }>(
      `SELECT count(*)::int AS c FROM event_invitations i JOIN guests g ON g.id=i.guest_id WHERE ${where}`,
      [functionId, ctx.workspace!.id],
    ))!.c;
    const rows = await this.db.query<any>(
      `SELECT i.id, g.display_name, g.phone_e164, gg.label AS group_label, i.invited_party_size,
              (SELECT m.status FROM scheduled_messages m WHERE m.invitation_id=i.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_status,
              (SELECT max(m.updated_at) FROM scheduled_messages m WHERE m.invitation_id=i.id AND m.status IN ('submitted','delivered','read')) AS last_contacted_at
         FROM event_invitations i JOIN guests g ON g.id=i.guest_id LEFT JOIN guest_groups gg ON gg.id=g.guest_group_id
        WHERE ${where} ORDER BY g.display_name LIMIT $3 OFFSET $4`,
      [functionId, ctx.workspace!.id, p.limit, (p.page - 1) * p.limit],
    );
    return {
      data: rows.map((r) => ({
        invitationId: r.id,
        guestName: r.display_name,
        phoneMasked: maskPhone(r.phone_e164),
        group: r.group_label,
        partySize: r.invited_party_size,
        lastMessageStatus: r.last_message_status,
        lastContactedAt: r.last_contacted_at,
      })),
      page: p.page,
      limit: p.limit,
      total,
    };
  }

  // ---------- catering ----------
  private async settingsFor(workspaceId: string, functionId: string, q: Q = this.db) {
    const s = await q.one<any>(`SELECT * FROM catering_settings WHERE workspace_id=$1 AND event_function_id=$2`, [workspaceId, functionId]);
    return {
      maybeWeightPercent: s?.maybe_weight_percent ?? 50,
      pendingWeightPercent: s?.pending_weight_percent ?? 0,
      bufferPercent: s?.buffer_percent ?? 5,
      mealRounding: s?.meal_rounding ?? 1,
      adultPricePaise: s?.adult_price_paise ?? null,
      childPricePaise: s?.child_price_paise ?? null,
    };
  }

  private async liveEstimate(workspaceId: string, functionId: string, q: Q = this.db) {
    const { r } = await this.functionSummary(workspaceId, functionId, q);
    const settings = await this.settingsFor(workspaceId, functionId, q);
    const inputs = {
      confirmedAdults: r.yes_adults,
      confirmedChildren: r.yes_children,
      maybeAdults: r.maybe_adults,
      maybeChildren: r.maybe_children,
      pendingPeople: r.pending_people,
    };
    const warnings: string[] = [];
    if (r.maybe_without_count > 0)
      warnings.push(`${r.maybe_without_count} "maybe" response(s) have no headcount and add nothing to the estimate.`);
    if (r.not_responded > 0 && settings.pendingWeightPercent === 0)
      warnings.push(
        `${r.not_responded} invitation(s) (up to ${r.pending_people} people) have not responded and are excluded. Adjust the pending weight to include them.`,
      );
    return { inputs, settings, estimate: calculateCatering(inputs, settings), warnings };
  }

  async catering(ctx: RequestCtx, eventId: string, functionId: string) {
    const { fn } = await this.scope.fn(ctx, eventId, functionId);
    const live = await this.liveEstimate(ctx.workspace!.id, functionId);
    const latest = await this.db.one<any>(
      `SELECT id, label, estimated_meals, estimated_cost_paise, created_at FROM catering_estimates WHERE event_function_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [functionId, ctx.workspace!.id],
    );
    return {
      functionId,
      functionName: fn.name,
      ...live,
      disclaimer: 'Planning estimate based on RSVPs and the assumptions shown. It is not an attendance guarantee or a catering order.',
      calculatedAt: new Date().toISOString(),
      latestSnapshot: latest
        ? {
            id: latest.id,
            label: latest.label,
            estimatedMeals: latest.estimated_meals,
            estimatedCostPaise: latest.estimated_cost_paise,
            createdAt: latest.created_at,
          }
        : null,
    };
  }

  async updateCateringSettings(ctx: RequestCtx, eventId: string, functionId: string, i: z.infer<typeof cateringSettingsSchema>) {
    return this.db.tx(async (q) => {
      await this.scope.fn(ctx, eventId, functionId, q);
      const cur = await this.settingsFor(ctx.workspace!.id, functionId, q);
      const n = { ...cur, ...Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)) };
      await q.query(
        `INSERT INTO catering_settings (workspace_id,event_function_id,maybe_weight_percent,pending_weight_percent,buffer_percent,meal_rounding,adult_price_paise,child_price_paise,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (workspace_id,event_function_id) DO UPDATE SET maybe_weight_percent=$3,pending_weight_percent=$4,buffer_percent=$5,meal_rounding=$6,adult_price_paise=$7,child_price_paise=$8,updated_by=$9,updated_at=now()`,
        [
          ctx.workspace!.id,
          functionId,
          n.maybeWeightPercent,
          n.pendingWeightPercent,
          n.bufferPercent,
          n.mealRounding,
          n.adultPricePaise,
          n.childPricePaise,
          ctx.user!.id,
        ],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'catering.settings_updated',
        resourceType: 'function',
        resourceId: functionId,
      });
      return this.settingsFor(ctx.workspace!.id, functionId, q);
    });
  }

  async saveSnapshot(ctx: RequestCtx, eventId: string, functionId: string, label?: string) {
    return this.db.tx(async (q) => {
      await this.scope.fn(ctx, eventId, functionId, q);
      const live = await this.liveEstimate(ctx.workspace!.id, functionId, q);
      const e = live.estimate;
      const row = await q.one<any>(
        `INSERT INTO catering_estimates (workspace_id,event_function_id,label,confirmed_adults,confirmed_children,tentative_people,pending_people,planning_buffer_percent,adult_meals,child_meals,estimated_meals,adult_price_paise,child_price_paise,estimated_cost_paise,assumptions,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, created_at`,
        [
          ctx.workspace!.id,
          functionId,
          label ?? null,
          live.inputs.confirmedAdults,
          live.inputs.confirmedChildren,
          live.inputs.maybeAdults + live.inputs.maybeChildren,
          live.inputs.pendingPeople,
          live.settings.bufferPercent,
          e.adultMeals,
          e.childMeals,
          e.estimatedMeals,
          live.settings.adultPricePaise,
          live.settings.childPricePaise,
          e.estimatedCostPaise,
          JSON.stringify({ settings: live.settings, breakdown: e.breakdown }),
          ctx.user!.id,
        ],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'catering.snapshot_saved',
        resourceType: 'function',
        resourceId: functionId,
        metadata: { meals: e.estimatedMeals },
      });
      return { id: row.id, createdAt: row.created_at, label: label ?? null, ...live };
    });
  }

  async snapshots(ctx: RequestCtx, eventId: string, functionId: string) {
    await this.scope.fn(ctx, eventId, functionId);
    const rows = await this.db.query<any>(
      `SELECT id,label,confirmed_adults,confirmed_children,tentative_people,pending_people,estimated_meals,estimated_cost_paise,assumptions,created_at FROM catering_estimates WHERE event_function_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 50`,
      [functionId, ctx.workspace!.id],
    );
    return {
      data: rows.map((r) => ({
        id: r.id,
        label: r.label,
        confirmedAdults: r.confirmed_adults,
        confirmedChildren: r.confirmed_children,
        tentativePeople: r.tentative_people,
        pendingPeople: r.pending_people,
        estimatedMeals: r.estimated_meals,
        estimatedCostPaise: r.estimated_cost_paise,
        assumptions: r.assumptions,
        createdAt: r.created_at,
      })),
    };
  }

  // ---------- exports ----------
  private static readonly KIND_PERM: Record<string, Permission> = {
    guests: 'guests:export',
    rsvps: 'exports:rsvps',
    catering: 'catering:read',
    checkins: 'exports:checkins',
  };

  async createExport(ctx: RequestCtx, eventId: string, i: z.infer<typeof exportSchema>) {
    if (!can(ctx.workspace!.role, ReportingService.KIND_PERM[i.kind])) {
      await this.audit.security(ctx, 'export_denied', { kind: i.kind, role: ctx.workspace!.role }, ctx.workspace!.id);
      throw forbidden();
    }
    const event = await this.scope.event(ctx, eventId);
    let csv: string;
    let rows: number;
    if (i.kind === 'guests') {
      const g = await this.db.query<any>(
        `SELECT g.display_name, g.phone_e164, g.email, g.preferred_language, gg.label AS grp, g.tags,
                COALESCE((SELECT string_agg(f.name || ':' || CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked' ELSE COALESCE(r.status,'pending') END, '; ' ORDER BY f.starts_at)
                            FROM event_invitations i JOIN event_functions f ON f.id=i.event_function_id LEFT JOIN rsvp_responses r ON r.invitation_id=i.id WHERE i.guest_id=g.id),'') AS invites
           FROM guests g LEFT JOIN guest_groups gg ON gg.id=g.guest_group_id WHERE g.workspace_id=$1 AND g.event_id=$2 AND g.deleted_at IS NULL ORDER BY lower(g.display_name)`,
        [ctx.workspace!.id, eventId],
      );
      rows = g.length;
      csv = toCsv(
        ['name', 'phone', 'email', 'language', 'group', 'tags', 'invitations'],
        g.map((x) => [x.display_name, x.phone_e164, x.email, x.preferred_language, x.grp, x.tags.join(';'), x.invites]),
      );
    } else {
      if (!i.functionId) throw unprocessable('FUNCTION_REQUIRED', 'functionId is required for this export');
      const { fn } = await this.scope.fn(ctx, eventId, i.functionId);
      if (i.kind === 'rsvps') {
        const r = await this.db.query<any>(
          `SELECT g.display_name, gg.label AS grp, i.invited_party_size, COALESCE(r.status, CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked' ELSE 'no_response' END) AS status, r.adult_count, r.child_count, r.responded_at, r.last_actor_type
             FROM event_invitations i JOIN guests g ON g.id=i.guest_id AND g.deleted_at IS NULL LEFT JOIN guest_groups gg ON gg.id=g.guest_group_id LEFT JOIN rsvp_responses r ON r.invitation_id=i.id
            WHERE i.event_function_id=$1 AND i.workspace_id=$2 ORDER BY lower(g.display_name)`,
          [i.functionId, ctx.workspace!.id],
        );
        rows = r.length;
        csv = toCsv(
          ['guest', 'group', 'invited_party_size', 'rsvp_status', 'adults', 'children', 'responded_at', 'last_updated_by'],
          r.map((x) => [
            x.display_name,
            x.grp,
            x.invited_party_size,
            x.status,
            x.adult_count,
            x.child_count,
            x.responded_at,
            x.last_actor_type,
          ]),
        );
      } else if (i.kind === 'catering') {
        const live = await this.liveEstimate(ctx.workspace!.id, i.functionId);
        const e = live.estimate;
        const lines: [string, unknown][] = [
          ['function', fn.name],
          ['confirmed_adults', live.inputs.confirmedAdults],
          ['confirmed_children', live.inputs.confirmedChildren],
          ['maybe_adults', live.inputs.maybeAdults],
          ['maybe_children', live.inputs.maybeChildren],
          ['not_responded_people_max', live.inputs.pendingPeople],
          ['maybe_weight_percent', live.settings.maybeWeightPercent],
          ['pending_weight_percent', live.settings.pendingWeightPercent],
          ['buffer_percent', live.settings.bufferPercent],
          ['meal_rounding', live.settings.mealRounding],
          ['adult_meals', e.adultMeals],
          ['child_meals', e.childMeals],
          ['estimated_meals', e.estimatedMeals],
          ['estimated_cost_paise', e.estimatedCostPaise],
          ['calculated_at', new Date().toISOString()],
        ];
        rows = lines.length;
        csv = toCsv(['measure', 'value'], lines);
      } else {
        const c = await this.db.query<any>(
          `SELECT g.display_name, c.adults_present, c.children_present, c.checked_in_at, c.method FROM check_ins c JOIN event_invitations i ON i.id=c.invitation_id JOIN guests g ON g.id=i.guest_id
            WHERE c.event_function_id=$1 AND c.workspace_id=$2 AND c.voided_at IS NULL ORDER BY c.checked_in_at`,
          [i.functionId, ctx.workspace!.id],
        );
        rows = c.length;
        csv = toCsv(
          ['guest', 'adults_present', 'children_present', 'checked_in_at', 'method'],
          c.map((x) => [x.display_name, x.adults_present, x.children_present, x.checked_in_at, x.method]),
        );
      }
    }
    return this.db.tx(async (q) => {
      const job = await q.one<any>(
        `INSERT INTO export_jobs (workspace_id,event_id,function_id,kind,requested_by,content_type,content,row_count,expires_at) VALUES ($1,$2,$3,$4,$5,'text/csv; charset=utf-8',$6,$7,$8) RETURNING id, expires_at`,
        [
          ctx.workspace!.id,
          eventId,
          i.functionId ?? null,
          i.kind,
          ctx.user!.id,
          csv,
          rows,
          addDays(new Date(), this.cfg.EXPORT_RETENTION_DAYS),
        ],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'export.created',
        resourceType: 'export',
        resourceId: job.id,
        metadata: { kind: i.kind, rows },
      });
      await this.analytics.track(q, 'report_exported', { workspaceId: ctx.workspace!.id, eventId: event.id, props: { kind: i.kind } });
      return {
        id: job.id,
        kind: i.kind,
        rowCount: rows,
        expiresAt: job.expires_at,
        downloadPath: `/v1/workspaces/${ctx.workspace!.id}/exports/${job.id}/download`,
      };
    });
  }

  async download(ctx: RequestCtx, exportId: string) {
    const j = await this.db.one<any>(
      `SELECT id, kind, content, content_type, status, expires_at FROM export_jobs WHERE id=$1 AND workspace_id=$2`,
      [exportId, ctx.workspace!.id],
    );
    if (!j) throw notFound('Export');
    const perm = j.kind === 'workspace_data' ? 'privacy:manage' : ReportingService.KIND_PERM[j.kind];
    if (!can(ctx.workspace!.role, perm as Permission)) throw forbidden();
    if (j.status !== 'ready' || new Date(j.expires_at) <= new Date() || j.content === null)
      throw new ApiError(410, 'EXPORT_EXPIRED', 'This export has expired. Create a new one.');
    await this.db.query(`UPDATE export_jobs SET download_count = download_count + 1 WHERE id=$1`, [exportId]);
    await this.audit.log(null, ctx, {
      workspaceId: ctx.workspace!.id,
      action: 'export.downloaded',
      resourceType: 'export',
      resourceId: exportId,
      metadata: { kind: j.kind },
    });
    return {
      content: j.content as string,
      contentType: j.content_type as string,
      filename: `shaadicount-${j.kind}-${j.id.slice(0, 8)}.${j.content_type.startsWith('application/json') ? 'json' : 'csv'}`,
    };
  }
}
