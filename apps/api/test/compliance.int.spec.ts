import { cpSync, mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import http from 'http';
import https from 'https';
import net from 'net';
import { Client as PgClient } from 'pg';
import request from 'supertest';
import { Client, createTestApp, idem, TestCtx } from './helpers';
import { addGuest, invitationFor, makeFixture, WS } from './fixtures';
import { DispatcherService } from '../src/messaging/dispatcher.service';
import { MIGRATIONS_DIR, migrate } from '../src/db/migrate';

/** Acceptance-matrix rows that need dedicated evidence (see docs/project/traceability.md). */
describe('acceptance matrix: remaining evidence', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  const NOON = new Date('2027-01-15T06:30:00Z');

  async function member(f: Awaited<ReturnType<typeof makeFixture>>, role: string) {
    const u = await Client.register(t.app, { name: role });
    await f.owner.post(`${WS(f.owner)}/members`, { email: u.email, role });
    await f.owner.put(`${WS(f.owner)}/members/${u.userId}/assignments`, { eventIds: [f.eventId] });
    u.workspaceId = f.owner.workspaceId;
    return u;
  }

  it('ROLE-01: check-in staff cannot export contacts or send campaigns, and each denial is audited', async () => {
    const f = await makeFixture(t.app);
    const g = await addGuest(f);
    void g;
    const staff = await member(f, 'checkin_staff');
    const camp = await f.owner.post(`${f.base()}/campaigns`, { name: 'x', kind: 'invitation' });
    expect((await staff.post(`${WS(f.owner)}/events/${f.eventId}/exports`, { kind: 'guests' })).status).toBe(403);
    expect(
      (
        await staff.post(
          `${f.base()}/campaigns/${camp.body.id}/schedule`,
          { confirmRecipientCount: 0, confirmEstimatedCostPaise: 0 },
          idem(),
        )
      ).status,
    ).toBe(403);
    expect((await staff.post(`${f.base()}/campaigns`, { name: 'y', kind: 'reminder' })).status).toBe(403);
    const denials = await t.db.query(
      `SELECT action FROM audit_logs WHERE workspace_id=$1 AND actor_user_id=$2 AND action LIKE 'security.%'`,
      [f.owner.workspaceId, staff.userId],
    );
    expect(denials.length).toBe(3);
  });

  it('CHECKIN-02: users without check-in permission cannot correct a check-in; authorised correction is audited', async () => {
    const f = await makeFixture(t.app);
    const g = await addGuest(f, { invite: { Mehendi: 2 } });
    const inv = await invitationFor(f, g.guestId);
    const ci = await f.owner.post(`${f.base()}/checkin`, { invitationId: inv.id, allowUnconfirmed: true, adults: 1 });
    const caterer = await member(f, 'caterer');
    const ro = await member(f, 'readonly');
    for (const u of [caterer, ro])
      expect((await u.post(`${f.base()}/checkin/${ci.body.checkIn.id}/void`, { reason: 'trying to tamper' })).status).toBe(403);
    expect((await t.db.one<any>(`SELECT voided_at FROM check_ins WHERE id=$1`, [ci.body.checkIn.id]))!.voided_at).toBeNull();
    expect((await f.owner.post(`${f.base()}/checkin/${ci.body.checkIn.id}/void`, { reason: 'Scanned wrong guest' })).status).toBe(200);
    expect((await t.db.query(`SELECT 1 FROM audit_logs WHERE action='checkin.voided' AND reason='Scanned wrong guest'`)).length).toBe(1);
  });

  it('RSVP-05: after the deadline guests are blocked but an authorised organizer override succeeds and is audited', async () => {
    const f = await makeFixture(t.app, { Past: { startsAt: '2020-01-02T10:00', rsvpDeadline: '2020-01-01T10:00' } });
    const g = await addGuest(f, { invite: { Past: 2 } });
    const inv = await invitationFor(f, g.guestId, 'Past');
    const guest = await request(t.app.getHttpServer())
      .put(`/v1/public/rsvp/${inv.token}/response`)
      .set('Idempotency-Key', `k-${randomUUID()}`)
      .send({ status: 'yes', adultCount: 1, childCount: 0, version: 0 });
    expect(guest.body.error.code).toBe('RSVP_DEADLINE_PASSED');
    const fix = await f.owner.put(`${f.base('Past')}/invitations/${inv.id}/response`, {
      status: 'yes',
      adultCount: 2,
      childCount: 0,
      reason: 'Host accepted late reply by phone',
    });
    expect(fix.status).toBe(200);
    expect((await t.db.query(`SELECT 1 FROM audit_logs WHERE action='rsvp.overridden' AND resource_id=$1`, [inv.id])).length).toBe(1);
  });

  it('RSVP-04 / OBS-01: logs carry a request id but never contain RSVP tokens, phone numbers or message text', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: any) => {
      lines.push(String(chunk));
      return true;
    }) as any);
    const t2 = await createTestApp({ LOG_LEVEL: 'info' });
    let token = '';
    let reqId = '';
    try {
      const f = await makeFixture(t2.app);
      const g = await addGuest(f, { name: 'Loggable Person', phone: '+919876512345' });
      token = (await invitationFor(f, g.guestId)).token;
      const r = await request(t2.app.getHttpServer()).get(`/v1/public/rsvp/${token}`);
      const bad = await request(t2.app.getHttpServer()).get(`/v1/public/rsvp/${'Z'.repeat(43)}`);
      reqId = bad.headers['x-request-id'];
      expect(bad.body.error.requestId).toBe(reqId);
      expect(r.status).toBe(200);
    } finally {
      await t2.close();
      spy.mockRestore();
    }
    const all = lines.join('');
    expect(all).toContain(reqId);
    expect(all).toContain('/v1/public/rsvp/[redacted]');
    expect(all).not.toContain(token);
    expect(all).not.toMatch(/9876512345|Loggable Person/);
  });

  it('MSG-02: with live messaging off, a full send cycle makes no outbound HTTP(S) call and uses only the fake provider', async () => {
    const f = await makeFixture(t.app);
    await f.owner.post(`${WS(f.owner)}/contact-authority-attestation`, { confirm: true });
    const g = await addGuest(f);
    await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/consents`, {
      guestIds: [g.guestId],
      channel: 'whatsapp',
      basis: 'organizer_attestation',
      evidenceNote: 'Gave number to host',
    });
    const c = await f.owner.post(`${f.base()}/campaigns`, { name: 'c', kind: 'invitation' });
    const pv = await f.owner.post(`${f.base()}/campaigns/${c.body.id}/preview`);
    await f.owner.post(
      `${f.base()}/campaigns/${c.body.id}/schedule`,
      { confirmRecipientCount: 1, confirmEstimatedCostPaise: pv.body.estimatedCostPaise },
      idem(),
    );
    const blocked: string[] = [];
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation((() => {
      blocked.push('fetch');
      throw new Error('outbound blocked');
    }) as any);
    const httpSpy = jest.spyOn(http, 'request').mockImplementation((() => {
      blocked.push('http');
      throw new Error('outbound blocked');
    }) as any);
    const httpsSpy = jest.spyOn(https, 'request').mockImplementation((() => {
      blocked.push('https');
      throw new Error('outbound blocked');
    }) as any);
    const remote: string[] = [];
    const origConnect = net.Socket.prototype.connect;
    const connSpy = jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: any[]) {
      const o = args[0];
      const host = typeof o === 'object' ? o.host : args[1];
      const port = typeof o === 'object' ? o.port : o;
      if (port !== 5432 && host !== 'localhost' && host !== '127.0.0.1' && host !== undefined) remote.push(`${host}:${port}`);
      return (origConnect as any).apply(this, args);
    } as any);
    try {
      const stats = await t.app.get(DispatcherService).runOnce(NOON);
      expect(stats.submitted).toBe(1);
    } finally {
      fetchSpy.mockRestore();
      httpSpy.mockRestore();
      httpsSpy.mockRestore();
      connSpy.mockRestore();
    }
    expect(blocked).toEqual([]);
    expect(remote).toEqual([]);
    expect((await t.db.one<any>(`SELECT provider FROM scheduled_messages WHERE campaign_id=$1`, [c.body.id]))!.provider).toBe('fake');
  });

  it('MSG-06: an unknown/mismatched template is refused before any message exists', async () => {
    const f = await makeFixture(t.app);
    const bad = await f.owner.post(`${f.base()}/campaigns`, { name: 'x', kind: 'invitation', templateKey: 'made_up_v9' });
    expect(bad.body.error.code).toBe('TEMPLATE_UNAVAILABLE');
    const wrongKind = await f.owner.post(`${f.base()}/campaigns`, { name: 'x', kind: 'invitation', templateKey: 'reminder_v1' });
    expect(wrongKind.body.error.code).toBe('TEMPLATE_UNAVAILABLE');
    expect(
      (await t.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM scheduled_messages WHERE workspace_id=$1`, [f.owner.workspaceId]))!.c,
    ).toBe(0);
  });

  it('EVENT-01: an invalid function leaves no partial data behind', async () => {
    const f = await makeFixture(t.app);
    const before = (await t.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM event_functions WHERE event_id=$1`, [f.eventId]))!.c;
    expect((await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/functions`, { name: 'Bad', startsAt: 'not a date' })).status).toBe(422);
    expect(
      (
        await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/functions`, {
          name: 'Bad2',
          startsAt: '2027-01-01T10:00',
          rsvpDeadline: '2027-01-02T10:00',
        })
      ).status,
    ).toBe(422);
    expect((await t.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM event_functions WHERE event_id=$1`, [f.eventId]))!.c).toBe(
      before,
    );
  });

  describe('DB-01: migrations', () => {
    const url = process.env.TEST_DATABASE_URL ?? 'postgres://shaadicount:shaadicount_local_dev@localhost:5432/shaadicount_test';
    const admin = () => {
      const u = new URL(url);
      u.pathname = '/postgres';
      return u.toString();
    };
    const dbUrl = (name: string) => {
      const u = new URL(url);
      u.pathname = `/${name}`;
      return u.toString();
    };
    it('applies every migration to an empty database, is idempotent, and refuses edits to applied migrations', async () => {
      const name = `migtest_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const a = new PgClient({ connectionString: admin() });
      await a.connect();
      await a.query(`CREATE DATABASE ${name}`);
      try {
        const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
        expect(await migrate(dbUrl(name))).toBe(files.length);
        expect(await migrate(dbUrl(name))).toBe(0);
        const c = new PgClient({ connectionString: dbUrl(name) });
        await c.connect();
        const tables = (await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n;
        expect(tables).toBeGreaterThanOrEqual(30);
        await c.end();
        const tampered = mkdtempSync(join(tmpdir(), 'mig-'));
        cpSync(MIGRATIONS_DIR, tampered, { recursive: true });
        const first = join(tampered, files[0]);
        writeFileSync(first, readFileSync(first, 'utf8') + '\n-- edited after being applied\n');
        await expect(migrate(dbUrl(name), tampered)).rejects.toThrow(/modified after being applied/);
      } finally {
        await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await a.end();
      }
    });
    it('rolls back a failing migration completely (no half-applied schema)', async () => {
      const name = `migfail_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const a = new PgClient({ connectionString: admin() });
      await a.connect();
      await a.query(`CREATE DATABASE ${name}`);
      try {
        const dir = mkdtempSync(join(tmpdir(), 'mig-'));
        writeFileSync(join(dir, '0001_ok.sql'), 'CREATE TABLE ok_table (id int);');
        writeFileSync(join(dir, '0002_bad.sql'), 'CREATE TABLE half_table (id int); SELECT * FROM does_not_exist;');
        await expect(migrate(dbUrl(name), dir)).rejects.toThrow(/0002_bad.sql failed/);
        const c = new PgClient({ connectionString: dbUrl(name) });
        await c.connect();
        const names = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map(
          (r) => r.table_name,
        );
        expect(names).toContain('ok_table');
        expect(names).not.toContain('half_table');
        expect((await c.query(`SELECT version FROM schema_migrations`)).rows.map((r) => r.version)).toEqual(['0001_ok.sql']);
        await c.end();
      } finally {
        await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await a.end();
      }
    });
  });
});
