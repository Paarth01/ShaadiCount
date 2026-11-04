import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, Q } from '../common/db.service';
import { ApiError, notFound, unprocessable } from '../common/errors';
import { IdempotencyService } from '../common/idempotency.service';
import { ScopeService } from '../common/scope.service';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { CHANNELS, SuppressionService } from './suppression.service';
import { isValidEmail, maskEmail, maskPhone, normalizePhone } from '../common/phone';
import { CsvError, ImportMapping, parseGuestCsv } from './import';
import { addDays } from '../common/time';
import { CONFIG, Config } from '../config/config';
import type { RequestCtx } from '../common/request';

const nullableText = (max: number) => z.string().trim().max(max).nullish();
const guestFields = z.object({
  displayName: z.string().trim().min(1).max(160),
  phone: nullableText(30),
  email: nullableText(254),
  preferredLanguage: z.enum(['en', 'hi']),
  groupId: z.string().uuid().nullish(),
  groupLabel: z.string().trim().min(1).max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
});
export const guestSchema = guestFields.extend({
  preferredLanguage: z.enum(['en', 'hi']).default('en'),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  allowDuplicate: z.boolean().default(false),
  invitations: z
    .array(z.object({ functionId: z.string().uuid(), partySize: z.number().int().min(1).max(50).default(1) }))
    .max(30)
    .default([]),
});
// A PATCH only changes the fields that are present (no create-time defaults are re-applied).
export const updateGuestSchema = guestFields.partial();
export const listGuestsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  groupId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const groupSchema = z.object({ label: z.string().trim().min(1).max(120) });
export const consentSchema = z.object({
  guestIds: z.array(z.string().uuid()).min(1).max(1000),
  channel: z.enum(CHANNELS),
  status: z.enum(['granted', 'revoked']).default('granted'),
  basis: z.enum(['organizer_attestation', 'guest_opt_in']),
  evidenceNote: z.string().trim().min(3, 'Describe how permission was obtained').max(500),
});
export const importPreviewSchema = z.object({
  csv: z.string().min(1),
  filename: z.string().max(200).optional(),
  mapping: z
    .object({
      name: z.string(),
      phone: z.string(),
      email: z.string(),
      language: z.string(),
      group: z.string(),
      functions: z.string(),
      partySize: z.string(),
      tags: z.string(),
    })
    .partial()
    .optional(),
});
export const importCommitSchema = z.object({ includeDuplicateRows: z.array(z.number().int().min(2)).max(5000).default([]) });

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

@Injectable()
export class GuestsService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly invitations: InvitationsService,
    private readonly suppression: SuppressionService,
    private readonly idem: IdempotencyService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  // ---------- groups ----------
  async listGroups(ctx: RequestCtx, eventId: string) {
    await this.scope.eventWide(ctx, eventId);
    const rows = await this.db.query<any>(
      `SELECT g.id, g.label, (SELECT count(*) FROM guests x WHERE x.guest_group_id=g.id AND x.deleted_at IS NULL)::int AS guest_count
         FROM guest_groups g WHERE g.event_id=$1 AND g.workspace_id=$2 AND g.deleted_at IS NULL ORDER BY lower(g.label)`,
      [eventId, ctx.workspace!.id],
    );
    return rows.map((r) => ({ id: r.id, label: r.label, guestCount: r.guest_count }));
  }
  private async groupInTx(q: Q, ctx: RequestCtx, eventId: string, label: string): Promise<string> {
    const ex = await q.one<{ id: string }>(
      `SELECT id FROM guest_groups WHERE event_id=$1 AND workspace_id=$2 AND lower(label)=lower($3) AND deleted_at IS NULL`,
      [eventId, ctx.workspace!.id, label],
    );
    if (ex) return ex.id;
    // Concurrent requests may race on the same new label. ON CONFLICT DO NOTHING (any unique index) makes the loser
    // wait for the winner's commit and then re-read the winner's row instead of failing with a 500.
    const g = await q.one<{ id: string }>(
      `INSERT INTO guest_groups (workspace_id,event_id,label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
      [ctx.workspace!.id, eventId, label],
    );
    if (g) return g.id;
    const again = await q.one<{ id: string }>(
      `SELECT id FROM guest_groups WHERE event_id=$1 AND workspace_id=$2 AND lower(label)=lower($3) AND deleted_at IS NULL`,
      [eventId, ctx.workspace!.id, label],
    );
    if (!again) throw new Error('guest group upsert failed');
    return again.id;
  }
  async createGroup(ctx: RequestCtx, eventId: string, label: string) {
    return this.db.tx(async (q) => {
      await this.scope.eventWide(ctx, eventId, q);
      const id = await this.groupInTx(q, ctx, eventId, label);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'guest_group.created',
        resourceType: 'guest_group',
        resourceId: id,
      });
      return { id, label };
    });
  }
  async deleteGroup(ctx: RequestCtx, eventId: string, groupId: string) {
    await this.db.tx(async (q) => {
      await this.scope.eventWide(ctx, eventId, q);
      const g = await q.one(
        `UPDATE guest_groups SET deleted_at=now() WHERE id=$1 AND event_id=$2 AND workspace_id=$3 AND deleted_at IS NULL RETURNING id`,
        [groupId, eventId, ctx.workspace!.id],
      );
      if (!g) throw notFound('Group');
      await q.query(`UPDATE guests SET guest_group_id=NULL, updated_at=now() WHERE guest_group_id=$1`, [groupId]);
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'guest_group.deleted',
        resourceType: 'guest_group',
        resourceId: groupId,
      });
    });
  }

  // ---------- guests ----------
  private dto(g: any, extra: Record<string, unknown> = {}) {
    return {
      id: g.id,
      displayName: g.display_name,
      phoneMasked: maskPhone(g.phone_e164),
      emailMasked: maskEmail(g.email),
      hasPhone: !!g.phone_e164,
      hasEmail: !!g.email,
      language: g.preferred_language,
      group: g.guest_group_id ? { id: g.guest_group_id, label: g.group_label } : null,
      tags: g.tags,
      createdAt: g.created_at,
      ...extra,
    };
  }

  async list(ctx: RequestCtx, eventId: string, f: z.infer<typeof listGuestsSchema>) {
    await this.scope.eventWide(ctx, eventId);
    const params: unknown[] = [ctx.workspace!.id, eventId];
    let where = 'g.workspace_id=$1 AND g.event_id=$2 AND g.deleted_at IS NULL';
    if (f.search) {
      params.push(`%${f.search.toLowerCase()}%`);
      where += ` AND lower(g.display_name) LIKE $${params.length}`;
    }
    if (f.groupId) {
      params.push(f.groupId);
      where += ` AND g.guest_group_id=$${params.length}`;
    }
    const total = (await this.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM guests g WHERE ${where}`, params))!.c;
    params.push(f.limit, (f.page - 1) * f.limit);
    const rows = await this.db.query<any>(
      `SELECT g.*, gg.label AS group_label,
         COALESCE((SELECT json_agg(json_build_object('functionId', i.event_function_id, 'invitationId', i.id, 'status', CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked' ELSE COALESCE(r.status,'pending') END))
                     FROM event_invitations i LEFT JOIN rsvp_responses r ON r.invitation_id=i.id WHERE i.guest_id=g.id), '[]'::json) AS invites,
         COALESCE((SELECT json_object_agg(c.channel, c.status) FROM (SELECT DISTINCT ON (channel) channel, status FROM communication_consents WHERE guest_id=g.id ORDER BY channel, recorded_at DESC) c), '{}'::json) AS consents
         FROM guests g LEFT JOIN guest_groups gg ON gg.id=g.guest_group_id WHERE ${where} ORDER BY lower(g.display_name), g.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: rows.map((g) => this.dto(g, { invitations: g.invites, consents: g.consents })), page: f.page, limit: f.limit, total };
  }

  async get(ctx: RequestCtx, eventId: string, guestId: string, reveal: boolean) {
    await this.scope.eventWide(ctx, eventId);
    const g = await this.db.one<any>(
      `SELECT g.*, gg.label AS group_label FROM guests g LEFT JOIN guest_groups gg ON gg.id=g.guest_group_id WHERE g.id=$1 AND g.event_id=$2 AND g.workspace_id=$3 AND g.deleted_at IS NULL`,
      [guestId, eventId, ctx.workspace!.id],
    );
    if (!g) throw notFound('Guest');
    const consents = await this.db.query<any>(
      `SELECT DISTINCT ON (channel) channel, status, basis, evidence_note, recorded_at FROM communication_consents WHERE guest_id=$1 AND workspace_id=$2 ORDER BY channel, recorded_at DESC`,
      [guestId, ctx.workspace!.id],
    );
    const extra: Record<string, unknown> = {
      consents: consents.map((c) => ({
        channel: c.channel,
        status: c.status,
        basis: c.basis,
        evidenceNote: c.evidence_note,
        recordedAt: c.recorded_at,
      })),
    };
    if (reveal) {
      extra.phone = g.phone_e164;
      extra.email = g.email;
      await this.audit.log(null, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'guest.contact_revealed',
        resourceType: 'guest',
        resourceId: guestId,
      });
    }
    return this.dto(g, extra);
  }

  private async findDuplicates(
    q: Q,
    workspaceId: string,
    eventId: string,
    phone: string | null,
    email: string | null,
    name: string,
    groupId: string | null,
    excludeId?: string,
  ) {
    const rows = await q.query<any>(
      `SELECT id, display_name FROM guests WHERE workspace_id=$1 AND event_id=$2 AND deleted_at IS NULL AND ($7::uuid IS NULL OR id <> $7)
         AND ( ($3::text IS NOT NULL AND phone_e164=$3) OR ($4::text IS NOT NULL AND lower(email)=$4) OR (lower(display_name)=$5 AND guest_group_id IS NOT DISTINCT FROM $6::uuid) ) LIMIT 5`,
      [workspaceId, eventId, phone, email, normName(name), groupId, excludeId ?? null],
    );
    return rows;
  }

  private parseContacts(i: { phone?: string | null; email?: string | null }) {
    let phone: string | null = null;
    let email: string | null = null;
    if (i.phone) {
      phone = normalizePhone(i.phone);
      if (!phone)
        throw unprocessable('INVALID_PHONE', 'Enter a valid mobile number', [
          { field: 'phone', message: 'Use a 10-digit Indian number or +country code' },
        ]);
    }
    if (i.email) {
      email = i.email.toLowerCase();
      if (!isValidEmail(email))
        throw unprocessable('INVALID_EMAIL', 'Enter a valid email address', [{ field: 'email', message: 'Invalid email' }]);
    }
    return { phone, email };
  }

  async create(ctx: RequestCtx, eventId: string, i: z.infer<typeof guestSchema>) {
    const { phone, email } = this.parseContacts(i);
    return this.db.tx(async (q) => {
      await this.scope.eventWide(ctx, eventId, q);
      let groupId: string | null = null;
      if (i.groupId) {
        const g = await q.one(`SELECT id FROM guest_groups WHERE id=$1 AND event_id=$2 AND workspace_id=$3 AND deleted_at IS NULL`, [
          i.groupId,
          eventId,
          ctx.workspace!.id,
        ]);
        if (!g) throw unprocessable('UNKNOWN_GROUP', 'Group not found in this event');
        groupId = i.groupId;
      } else if (i.groupLabel) groupId = await this.groupInTx(q, ctx, eventId, i.groupLabel);
      if (!i.allowDuplicate) {
        const dups = await this.findDuplicates(q, ctx.workspace!.id, eventId, phone, email, i.displayName, groupId);
        if (dups.length)
          throw new ApiError(
            409,
            'DUPLICATE_GUEST',
            'A guest with the same phone, email or name already exists in this event',
            [],
            {},
            { duplicates: dups.map((d) => ({ id: d.id, displayName: d.display_name })) },
          );
      }
      const g = await q.one<any>(
        `INSERT INTO guests (workspace_id,event_id,guest_group_id,display_name,phone_e164,email,preferred_language,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [ctx.workspace!.id, eventId, groupId, i.displayName, phone, email, i.preferredLanguage, i.tags],
      );
      for (const inv of i.invitations) {
        const { fn } = await this.scope.fn(ctx, eventId, inv.functionId, q);
        await this.invitations.createInTx(q, ctx.workspace!.id, fn, [{ guestId: g.id, partySize: inv.partySize }]);
      }
      await this.audit.log(q, ctx, { workspaceId: ctx.workspace!.id, action: 'guest.created', resourceType: 'guest', resourceId: g.id });
      return this.dto({ ...g, group_label: null });
    });
  }

  async update(ctx: RequestCtx, eventId: string, guestId: string, i: z.infer<typeof updateGuestSchema>) {
    return this.db.tx(async (q) => {
      await this.scope.eventWide(ctx, eventId, q);
      const cur = await q.one<any>(
        `SELECT * FROM guests WHERE id=$1 AND event_id=$2 AND workspace_id=$3 AND deleted_at IS NULL FOR UPDATE`,
        [guestId, eventId, ctx.workspace!.id],
      );
      if (!cur) throw notFound('Guest');
      const c = this.parseContacts({
        phone: i.phone === undefined ? cur.phone_e164 : i.phone,
        email: i.email === undefined ? cur.email : i.email,
      });
      let groupId = cur.guest_group_id as string | null;
      if (i.groupId !== undefined) {
        if (i.groupId) {
          const g = await q.one(`SELECT id FROM guest_groups WHERE id=$1 AND event_id=$2 AND workspace_id=$3 AND deleted_at IS NULL`, [
            i.groupId,
            eventId,
            ctx.workspace!.id,
          ]);
          if (!g) throw unprocessable('UNKNOWN_GROUP', 'Group not found in this event');
        }
        groupId = i.groupId ?? null;
      } else if (i.groupLabel) groupId = await this.groupInTx(q, ctx, eventId, i.groupLabel);
      const r = await q.one<any>(
        `UPDATE guests SET display_name=$2, phone_e164=$3, email=$4, preferred_language=$5, guest_group_id=$6, tags=$7, updated_at=now() WHERE id=$1 RETURNING *`,
        [
          guestId,
          i.displayName ?? cur.display_name,
          c.phone,
          c.email,
          i.preferredLanguage ?? cur.preferred_language,
          groupId,
          i.tags ?? cur.tags,
        ],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'guest.updated',
        resourceType: 'guest',
        resourceId: guestId,
        metadata: { fields: Object.keys(i) },
      });
      return this.dto({ ...r, group_label: null });
    });
  }

  /**
   * Guest deletion = erasure of personal data: name/contacts are scrubbed, invitations revoked, pending messages cancelled.
   * Anonymous aggregate RSVP history is kept; opt-out evidence is untouched (it is not linked to the guest row).
   */
  async remove(ctx: RequestCtx, eventId: string, guestId: string) {
    await this.db.tx(async (q) => {
      await this.scope.eventWide(ctx, eventId, q);
      const g = await q.one(
        `UPDATE guests SET display_name='Deleted guest', phone_e164=NULL, email=NULL, tags='{}', deleted_at=now(), anonymized_at=now(), updated_at=now()
                              WHERE id=$1 AND event_id=$2 AND workspace_id=$3 AND deleted_at IS NULL RETURNING id`,
        [guestId, eventId, ctx.workspace!.id],
      );
      if (!g) throw notFound('Guest');
      await q.query(
        `UPDATE event_invitations SET revoked_at=COALESCE(revoked_at, now()), status='revoked', updated_at=now() WHERE guest_id=$1`,
        [guestId],
      );
      await q.query(
        `UPDATE scheduled_messages SET status='cancelled', skip_reason='guest_deleted', locked_until=NULL, updated_at=now()
                      WHERE invitation_id IN (SELECT id FROM event_invitations WHERE guest_id=$1) AND status IN ('scheduled','queued')`,
        [guestId],
      );
      await this.audit.log(q, ctx, { workspaceId: ctx.workspace!.id, action: 'guest.deleted', resourceType: 'guest', resourceId: guestId });
    });
  }

  // ---------- consent evidence ----------
  async recordConsent(ctx: RequestCtx, eventId: string, i: z.infer<typeof consentSchema>) {
    return this.db.tx(async (q) => {
      await this.scope.eventWide(ctx, eventId, q);
      const ids = [...new Set(i.guestIds)];
      const ok = await q.query<{ id: string }>(
        `SELECT id FROM guests WHERE id = ANY($1::uuid[]) AND workspace_id=$2 AND event_id=$3 AND deleted_at IS NULL`,
        [ids, ctx.workspace!.id, eventId],
      );
      if (ok.length !== ids.length) throw unprocessable('UNKNOWN_GUEST', 'One or more guests do not belong to this event');
      await q.query(
        `INSERT INTO communication_consents (workspace_id,event_id,guest_id,channel,status,basis,evidence_note,recorded_by)
         SELECT $1,$2,x,$3,$4,$5,$6,$7 FROM unnest($8::uuid[]) AS x`,
        [ctx.workspace!.id, eventId, i.channel, i.status, i.basis, i.evidenceNote, ctx.user!.id, ids],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: `consent.${i.status}`,
        resourceType: 'event',
        resourceId: eventId,
        metadata: { channel: i.channel, basis: i.basis, guests: ids.length },
      });
      return { recorded: ids.length };
    });
  }

  // ---------- CSV import ----------
  private async functionMap(ctx: RequestCtx, eventId: string, q: Q = this.db) {
    const rows = await q.query<{ id: string; name: string }>(`SELECT id, name FROM event_functions WHERE event_id=$1 AND workspace_id=$2`, [
      eventId,
      ctx.workspace!.id,
    ]);
    return new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
  }

  private async analyse(ctx: RequestCtx, eventId: string, csv: string, mapping: ImportMapping | undefined, q: Q = this.db) {
    let parsed;
    try {
      parsed = parseGuestCsv(csv, mapping, await this.functionMap(ctx, eventId, q));
    } catch (e) {
      if (e instanceof CsvError) throw unprocessable('CSV_INVALID', e.message);
      throw e;
    }
    const existing = await q.query<any>(
      `SELECT phone_e164, lower(email) AS email, lower(display_name) AS name, guest_group_id, (SELECT lower(label) FROM guest_groups gg WHERE gg.id=guests.guest_group_id) AS group_label
                                          FROM guests WHERE workspace_id=$1 AND event_id=$2 AND deleted_at IS NULL`,
      [ctx.workspace!.id, eventId],
    );
    const phones = new Set(existing.map((e) => e.phone_e164).filter(Boolean));
    const emails = new Set(existing.map((e) => e.email).filter(Boolean));
    const names = new Set(existing.map((e) => `${normName(e.name)}|${e.group_label ?? ''}`));
    const seen = { phones: new Map<string, number>(), emails: new Map<string, number>(), names: new Map<string, number>() };
    const out = parsed.rows.map((r) => {
      let status: 'valid' | 'error' | 'duplicate' = r.errors.length ? 'error' : 'valid';
      let duplicateOf: { reason: string; row?: number } | undefined;
      if (r.data) {
        const d = r.data;
        const nk = `${normName(d.name)}|${(d.group ?? '').toLowerCase()}`;
        if (d.phone && phones.has(d.phone)) duplicateOf = { reason: 'phone_already_in_event' };
        else if (d.phone && seen.phones.has(d.phone)) duplicateOf = { reason: 'phone_repeated_in_file', row: seen.phones.get(d.phone) };
        else if (d.email && emails.has(d.email)) duplicateOf = { reason: 'email_already_in_event' };
        else if (d.email && seen.emails.has(d.email)) duplicateOf = { reason: 'email_repeated_in_file', row: seen.emails.get(d.email) };
        else if (names.has(nk)) duplicateOf = { reason: 'name_and_group_already_in_event' };
        else if (seen.names.has(nk)) duplicateOf = { reason: 'name_and_group_repeated_in_file', row: seen.names.get(nk) };
        if (duplicateOf) status = 'duplicate';
        if (d.phone && !seen.phones.has(d.phone)) seen.phones.set(d.phone, r.rowNumber);
        if (d.email && !seen.emails.has(d.email)) seen.emails.set(d.email, r.rowNumber);
        if (!seen.names.has(nk)) seen.names.set(nk, r.rowNumber);
      }
      return { ...r, status, duplicateOf };
    });
    return { mapping: parsed.mapping, headers: parsed.headers, rows: out };
  }

  async importPreview(ctx: RequestCtx, eventId: string, i: z.infer<typeof importPreviewSchema>) {
    return this.db.tx(async (q) => {
      await this.scope.eventWide(ctx, eventId, q);
      const a = await this.analyse(ctx, eventId, i.csv, i.mapping, q);
      const summary = {
        totalRows: a.rows.length,
        valid: a.rows.filter((r) => r.status === 'valid').length,
        duplicates: a.rows.filter((r) => r.status === 'duplicate').length,
        errors: a.rows.filter((r) => r.status === 'error').length,
      };
      const masked = a.rows.map((r) => ({
        rowNumber: r.rowNumber,
        status: r.status,
        errors: r.errors,
        warnings: r.warnings,
        duplicateOf: r.duplicateOf,
        guest: r.data
          ? {
              name: r.data.name,
              phone: maskPhone(r.data.phone),
              email: maskEmail(r.data.email),
              language: r.data.language,
              group: r.data.group,
              functions: r.data.functionNames,
              partySize: r.data.partySize,
            }
          : null,
      }));
      const job = await q.one<{ id: string }>(
        `INSERT INTO import_jobs (workspace_id,event_id,created_by,filename,raw_csv,mapping,preview,summary,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          ctx.workspace!.id,
          eventId,
          ctx.user!.id,
          i.filename ?? null,
          i.csv,
          JSON.stringify(a.mapping),
          JSON.stringify(masked.slice(0, 500)),
          JSON.stringify(summary),
          addDays(new Date(), this.cfg.IMPORT_RETENTION_DAYS),
        ],
      );
      await this.audit.log(q, ctx, {
        workspaceId: ctx.workspace!.id,
        action: 'guest_import.previewed',
        resourceType: 'import',
        resourceId: job!.id,
        metadata: summary,
      });
      return {
        importId: job!.id,
        mapping: a.mapping,
        headers: a.headers,
        summary,
        rows: masked.slice(0, 500),
        rowsTruncated: masked.length > 500,
      };
    });
  }

  async importGet(ctx: RequestCtx, eventId: string, importId: string) {
    await this.scope.eventWide(ctx, eventId);
    const j = await this.db.one<any>(
      `SELECT id, status, summary, result, preview, created_at, committed_at FROM import_jobs WHERE id=$1 AND event_id=$2 AND workspace_id=$3`,
      [importId, eventId, ctx.workspace!.id],
    );
    if (!j) throw notFound('Import');
    return {
      importId: j.id,
      status: j.status,
      summary: j.summary,
      result: j.result,
      rows: j.status === 'previewed' ? j.preview : undefined,
      createdAt: j.created_at,
      committedAt: j.committed_at,
    };
  }

  /** Commits only validated rows. Duplicates are skipped unless explicitly included by row number. Safe to retry (idempotent). */
  async importCommit(
    ctx: RequestCtx,
    eventId: string,
    importId: string,
    key: string | undefined,
    input: z.infer<typeof importCommitSchema>,
  ) {
    return this.idem.run(
      { scope: `${ctx.workspace!.id}|${ctx.user!.id}`, operation: `imports.commit:${importId}`, key, required: true, request: input },
      async (q) => {
        await this.scope.eventWide(ctx, eventId, q);
        const job = await q.one<any>(`SELECT * FROM import_jobs WHERE id=$1 AND event_id=$2 AND workspace_id=$3 FOR UPDATE`, [
          importId,
          eventId,
          ctx.workspace!.id,
        ]);
        if (!job) throw notFound('Import');
        if (job.status === 'committed') return { status: 200, body: job.result };
        if (job.status !== 'previewed' || !job.raw_csv)
          throw new ApiError(409, 'IMPORT_EXPIRED', 'This import preview expired. Upload the file again.');
        const a = await this.analyse(ctx, eventId, job.raw_csv, job.mapping, q);
        const include = new Set(input.includeDuplicateRows);
        const fnRows = await q.query<any>(`SELECT id, event_id FROM event_functions WHERE event_id=$1 AND workspace_id=$2`, [
          eventId,
          ctx.workspace!.id,
        ]);
        const fnById = new Map(fnRows.map((f) => [f.id, f]));
        const groupCache = new Map<string, string>();
        let created = 0,
          invitationsCreated = 0,
          skippedDuplicates = 0,
          skippedErrors = 0;
        for (const r of a.rows) {
          if (r.status === 'error' || !r.data) {
            skippedErrors++;
            continue;
          }
          if (r.status === 'duplicate' && !include.has(r.rowNumber)) {
            skippedDuplicates++;
            continue;
          }
          const d = r.data;
          let groupId: string | null = null;
          if (d.group) {
            const k = d.group.toLowerCase();
            if (!groupCache.has(k)) groupCache.set(k, await this.groupInTx(q, ctx, eventId, d.group));
            groupId = groupCache.get(k)!;
          }
          const g = await q.one<{ id: string }>(
            `INSERT INTO guests (workspace_id,event_id,guest_group_id,display_name,phone_e164,email,preferred_language,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [ctx.workspace!.id, eventId, groupId, d.name, d.phone, d.email, d.language, d.tags],
          );
          created++;
          for (const fid of d.functionIds) {
            const res = await this.invitations.createInTx(q, ctx.workspace!.id, fnById.get(fid)!, [
              { guestId: g!.id, partySize: d.partySize },
            ]);
            invitationsCreated += res.created.length;
          }
        }
        const result = {
          importId,
          status: 'committed',
          created,
          invitationsCreated,
          skippedDuplicates,
          skippedErrors,
          messagingAuthorized: false,
          note: 'Importing contacts does not grant permission to message them. Record consent evidence before scheduling messages.',
        };
        await q.query(`UPDATE import_jobs SET status='committed', result=$2, committed_at=now(), raw_csv=NULL WHERE id=$1`, [
          importId,
          JSON.stringify(result),
        ]);
        await this.audit.log(q, ctx, {
          workspaceId: ctx.workspace!.id,
          action: 'guest_import.committed',
          resourceType: 'import',
          resourceId: importId,
          metadata: { created, invitationsCreated, skippedDuplicates, skippedErrors },
        });
        await this.analytics.track(q, 'guest_import_completed', {
          workspaceId: ctx.workspace!.id,
          eventId,
          props: { created, invitationsCreated },
        });
        return { status: 201, body: result };
      },
    );
  }
}
