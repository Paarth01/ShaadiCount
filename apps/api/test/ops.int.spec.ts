import { randomUUID } from 'crypto';
import request from 'supertest';
import { Client, createTestApp, idem, TestCtx } from './helpers';
import { addGuest, Fixture, invitationFor, makeFixture, WS } from './fixtures';
import { PrivacyService, RetentionService } from '../src/privacy/privacy.service';
import { ROLES, Role } from '../src/auth/permissions';

describe('operations: check-in, catering, exports, privacy, roles, sessions', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp({ DELETION_GRACE_DAYS: '0' });
  });
  afterAll(async () => {
    await t.close();
  });

  const rsvp = (token: string, body: object) =>
    request(t.app.getHttpServer()).put(`/v1/public/rsvp/${token}/response`).set('Idempotency-Key', `k-${randomUUID()}`).send(body);
  const answer = async (f: Fixture, guestId: string, body: object, fnName = 'Mehendi') => {
    const i = await invitationFor(f, guestId, fnName);
    await rsvp(i.token, { version: 0, ...body });
    return i;
  };

  async function addMember(f: Fixture, role: Role, scope: { events?: string[]; functions?: string[] } = {}) {
    const u = await Client.register(t.app, { name: `${role} user` });
    const r = await f.owner.post(`${WS(f.owner)}/members`, { email: u.email, role });
    expect(r.status).toBe(201);
    if (scope.events || scope.functions)
      await f.owner.put(`${WS(f.owner)}/members/${u.userId}/assignments`, {
        eventIds: scope.events ?? [],
        functionIds: scope.functions ?? [],
      });
    u.workspaceId = f.owner.workspaceId;
    return u;
  }

  describe('check-in', () => {
    it('checks in by QR code and manually, returns duplicate indication, and keeps exactly one active record under races', async () => {
      const f = await makeFixture(t.app);
      const a = await addGuest(f, { name: 'Qr Guest', invite: { Mehendi: 3 } });
      const b = await addGuest(f, { name: 'Manual Guest', invite: { Mehendi: 2 } });
      const c = await addGuest(f, { name: 'Race Guest', invite: { Mehendi: 2 } });
      for (const g of [a, b, c]) await answer(f, g.guestId, { status: 'yes', adultCount: 2, childCount: 0 });
      const code = (await rsvp((await invitationFor(f, a.guestId)).token, { status: 'yes', adultCount: 3, childCount: 0, version: 1 })).body
        .checkinCode;
      const url = `${f.base()}/checkin`;
      const qr = await f.owner.post(url, { code });
      expect(qr.status).toBe(201);
      expect(qr.body.checkIn).toMatchObject({ adults: 3, children: 0, method: 'qr' });
      const again = await f.owner.post(url, { code });
      expect(again.status).toBe(200);
      expect(again.body.duplicate).toBe(true);
      const manual = await f.owner.post(url, { invitationId: (await invitationFor(f, b.guestId)).id, adults: 1 });
      expect(manual.body.checkIn).toMatchObject({ adults: 1, method: 'manual' });
      const target = (await invitationFor(f, c.guestId)).id;
      const results = await Promise.all(Array.from({ length: 6 }, () => f.owner.post(url, { invitationId: target })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
      const active = await t.db.one<{ c: number }>(
        `SELECT count(*)::int AS c FROM check_ins WHERE invitation_id=$1 AND voided_at IS NULL`,
        [target],
      );
      expect(active!.c).toBe(1);
    });
    it('needs explicit confirmation for guests who did not say Yes, caps at party size, and supports audited void + re-check-in', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { name: 'Maybe Guest', invite: { Mehendi: 2 } });
      const inv = await answer(f, g.guestId, { status: 'maybe', adultCount: 1, childCount: 0 });
      const url = `${f.base()}/checkin`;
      expect((await f.owner.post(url, { invitationId: inv.id })).body.error.code).toBe('RSVP_NOT_CONFIRMED');
      expect((await f.owner.post(url, { invitationId: inv.id, allowUnconfirmed: true, adults: 5 })).body.error.code).toBe(
        'PARTY_SIZE_EXCEEDED',
      );
      const ok = await f.owner.post(url, { invitationId: inv.id, allowUnconfirmed: true, adults: 2 });
      expect(ok.status).toBe(201);
      const rec = await f.owner.get(`${f.base()}/checkin/reconciliation`);
      expect(rec.body).toMatchObject({ partial: true, checkedInPeople: 2, arrivedWithoutYes: 2 });
      const v = await f.owner.post(`${url}/${ok.body.checkIn.id}/void`, { reason: 'Wrong person scanned' });
      expect(v.status).toBe(200);
      expect((await f.owner.post(url, { invitationId: inv.id, allowUnconfirmed: true, adults: 1 })).status).toBe(201);
      expect((await t.db.query(`SELECT 1 FROM audit_logs WHERE action='checkin.voided' AND reason='Wrong person scanned'`)).length).toBe(1);
      await f.owner.patch(`${WS(f.owner)}/events/${f.eventId}/functions/${f.fn.Mehendi}`, { status: 'completed' });
      expect((await f.owner.get(`${f.base()}/checkin/reconciliation`)).body.partial).toBe(false);
    });
    it('rejects codes from another function and revoked invitations', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { invite: { Mehendi: 2, Wedding: 2 } });
      const wedding = await answer(f, g.guestId, { status: 'yes', adultCount: 1, childCount: 0 }, 'Wedding');
      const code = (await request(t.app.getHttpServer()).get(`/v1/public/rsvp/${wedding.token}`)).body.checkinCode;
      expect((await f.owner.post(`${f.base('Mehendi')}/checkin`, { code })).status).toBe(404);
      await f.owner.post(`${f.base('Wedding')}/invitations/${wedding.id}/revoke`, {});
      expect((await f.owner.post(`${f.base('Wedding')}/checkin`, { code })).body.error.code).toBe('INVITATION_REVOKED');
    });
    it('gate staff only reach assigned functions and see minimal guest data', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { name: 'Gate Guest', invite: { Mehendi: 2, Wedding: 2 } });
      await answer(f, g.guestId, { status: 'yes', adultCount: 1, childCount: 0 });
      const staff = await addMember(f, 'checkin_staff', { functions: [f.fn.Mehendi] });
      const search = await staff.get(`${f.base()}/checkin/search?q=gate`);
      expect(search.status).toBe(200);
      expect(Object.keys(search.body.data[0]).sort()).toEqual([
        'checkedIn',
        'group',
        'guestName',
        'invitationId',
        'partySize',
        'phoneLast4',
        'revoked',
        'rsvp',
      ]);
      expect((await staff.get(`${f.base('Wedding')}/checkin/search?q=gate`)).status).toBe(404);
      expect((await staff.get(`${WS(f.owner)}/events/${f.eventId}/guests`)).status).toBe(403);
      const ev = await staff.get(`${WS(f.owner)}/events/${f.eventId}`);
      expect(ev.body.functions.map((x: any) => x.name)).toEqual(['Mehendi']);
      expect((await staff.post(`${f.base()}/checkin`, { invitationId: (await invitationFor(f, g.guestId)).id })).status).toBe(201);
    });
  });

  describe('catering and exports', () => {
    it('recalculates from live RSVPs using documented assumptions and stores snapshots', async () => {
      const f = await makeFixture(t.app);
      const [a, b, c, d] = [
        await addGuest(f, { invite: { Mehendi: 4 } }),
        await addGuest(f, { invite: { Mehendi: 4 } }),
        await addGuest(f, { invite: { Mehendi: 4 } }),
        await addGuest(f, { invite: { Mehendi: 3 } }),
      ];
      await answer(f, a.guestId, { status: 'yes', adultCount: 2, childCount: 1 });
      await answer(f, b.guestId, { status: 'yes', adultCount: 4, childCount: 0 });
      await answer(f, c.guestId, { status: 'maybe', adultCount: 2, childCount: 0 });
      void d; // never responded: 3 people pending
      const url = `${f.base()}/catering`;
      const s = await f.owner.put(`${url}/settings`, {
        maybeWeightPercent: 50,
        pendingWeightPercent: 0,
        bufferPercent: 10,
        mealRounding: 5,
        adultPricePaise: 50000,
        childPricePaise: 30000,
      });
      expect(s.status).toBe(200);
      const e1 = (await f.owner.get(url)).body;
      expect(e1.inputs).toEqual({ confirmedAdults: 6, confirmedChildren: 1, maybeAdults: 2, maybeChildren: 0, pendingPeople: 3 });
      // adults 6 + 1 (half of 2 maybes) = 7 x1.1 = 7.7 -> 8; children 1 x1.1 -> 2; total 10 (already multiple of 5)
      expect(e1.estimate).toMatchObject({ adultMeals: 8, childMeals: 2, estimatedMeals: 10, estimatedCostPaise: 8 * 50000 + 2 * 30000 });
      expect(e1.warnings.join(' ')).toMatch(/not responded/);
      await answer(f, d.guestId, { status: 'yes', adultCount: 3, childCount: 0 });
      const e2 = (await f.owner.get(url)).body;
      expect(e2.estimate.estimatedMeals).toBeGreaterThan(e1.estimate.estimatedMeals);
      const snap = await f.owner.post(`${url}/snapshots`, { label: 'Sent to caterer' });
      expect(snap.status).toBe(201);
      expect((await f.owner.get(`${url}/snapshots`)).body.data[0]).toMatchObject({
        label: 'Sent to caterer',
        estimatedMeals: e2.estimate.estimatedMeals,
      });
    });
    it('caterer sees aggregate catering data only; contact exports are forbidden and audited', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { name: 'Private Person', phone: '+919002000015' });
      await answer(f, g.guestId, { status: 'yes', adultCount: 2, childCount: 0 });
      const caterer = await addMember(f, 'caterer', { events: [f.eventId] });
      const cat = await caterer.get(`${f.base()}/catering`);
      expect(cat.status).toBe(200);
      expect(JSON.stringify(cat.body)).not.toMatch(/Private Person|9002000015/);
      const exp = await caterer.post(`${WS(f.owner)}/events/${f.eventId}/exports`, { kind: 'catering', functionId: f.fn.Mehendi });
      expect(exp.status).toBe(201);
      const dl = await caterer.get(exp.body.downloadPath);
      expect(dl.headers['content-type']).toContain('text/csv');
      expect(dl.text).toContain('estimated_meals');
      expect((await caterer.post(`${WS(f.owner)}/events/${f.eventId}/exports`, { kind: 'guests' })).status).toBe(403);
      expect((await caterer.get(`${WS(f.owner)}/events/${f.eventId}/guests`)).status).toBe(403);
      expect(
        (await t.db.query(`SELECT 1 FROM audit_logs WHERE action='security.export_denied' AND workspace_id=$1`, [f.owner.workspaceId]))
          .length,
      ).toBe(1);
    });
    it('neutralises spreadsheet formulas in CSV exports and audits the export', async () => {
      const f = await makeFixture(t.app);
      await addGuest(f, { name: '=HYPERLINK("http://evil","x")' });
      await addGuest(f, { name: '+SUM(1,1)' });
      const exp = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/exports`, { kind: 'guests' });
      const csv = (await f.owner.get(exp.body.downloadPath)).text;
      expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
      expect(csv).toContain("'+SUM(1");
      expect(csv).not.toMatch(/^=|,=|\n=|\n\+/);
      expect((await t.db.query(`SELECT 1 FROM audit_logs WHERE action='export.created' AND resource_id=$1`, [exp.body.id])).length).toBe(1);
    });
    it('expired exports are purged by retention and return 410', async () => {
      const f = await makeFixture(t.app);
      await addGuest(f);
      const exp = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/exports`, { kind: 'guests' });
      await t.db.query(`UPDATE export_jobs SET expires_at = now() - interval '1 minute' WHERE id=$1`, [exp.body.id]);
      expect((await f.owner.get(exp.body.downloadPath)).status).toBe(410);
      await t.app.get(RetentionService).runOnce();
      expect(await t.db.one<any>(`SELECT content, status FROM export_jobs WHERE id=$1`, [exp.body.id])).toEqual({
        content: null,
        status: 'expired',
      });
    });
  });

  describe('privacy: export and deletion', () => {
    it('exports workspace data as JSON without tokens or message bodies', async () => {
      const f = await makeFixture(t.app);
      await addGuest(f, { name: 'Exported Guest' });
      const r = await f.owner.post(`${WS(f.owner)}/data-requests`, { type: 'export' });
      expect(r.status).toBe(201);
      const data = JSON.parse((await f.owner.get(r.body.downloadPath)).text);
      expect(data.guests[0].display_name).toBe('Exported Guest');
      expect(JSON.stringify(data)).not.toMatch(/token_hash|checkin_code|"body"/);
    });
    it('deletes personal data after confirmation + grace period while retaining opt-out evidence and audit logs', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { name: 'Doomed Guest' });
      await answer(f, g.guestId, { status: 'yes', adultCount: 1, childCount: 0 });
      await f.owner.post(`${WS(f.owner)}/suppressions`, { channel: 'whatsapp', contact: '+919002555515' });
      expect(
        (await f.owner.post(`${WS(f.owner)}/data-requests`, { type: 'deletion', confirmWorkspaceName: 'wrong' })).body.error.code,
      ).toBe('CONFIRMATION_MISMATCH');
      const req = await f.owner.post(`${WS(f.owner)}/data-requests`, { type: 'deletion', confirmWorkspaceName: 'Fixture Weddings' });
      expect(req.status).toBe(201);
      expect(req.body.status).toBe('scheduled');
      const cancelled = await f.owner.post(`${WS(f.owner)}/data-requests/${req.body.id}/cancel`);
      expect(cancelled.body.status).toBe('cancelled');
      const req2 = await f.owner.post(`${WS(f.owner)}/data-requests`, { type: 'deletion', confirmWorkspaceName: 'Fixture Weddings' });
      expect(await t.app.get(PrivacyService).executeDueDeletions(new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(1);
      expect(req2.body.status).toBe('scheduled');
      const ws = f.owner.workspaceId;
      for (const table of [
        'guests',
        'events',
        'event_functions',
        'event_invitations',
        'rsvp_responses',
        'rsvp_response_history',
        'workspace_members',
      ]) {
        expect((await t.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM ${table} WHERE workspace_id=$1`, [ws]))!.c).toBe(0);
      }
      expect(
        (await t.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM communication_suppressions WHERE workspace_id=$1`, [ws]))!.c,
      ).toBe(1);
      expect(
        (await t.db.one<{ c: number }>(
          `SELECT count(*)::int AS c FROM audit_logs WHERE workspace_id=$1 AND action='privacy.workspace_deleted'`,
          [ws],
        ))!.c,
      ).toBe(1);
      expect((await f.owner.get(WS(f.owner))).status).toBe(404);
    });
  });

  describe('authorisation', () => {
    it('enforces the role matrix on representative endpoints (deny by default)', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f);
      await answer(f, g.guestId, { status: 'yes', adultCount: 1, childCount: 0 });
      const ev = `${WS(f.owner)}/events/${f.eventId}`;
      const probes: [string, (c: Client) => Promise<{ status: number }>, Role[]][] = [
        ['list events', (c) => c.get(`${WS(f.owner)}/events`), [...ROLES]],
        ['create event', (c) => c.post(`${WS(f.owner)}/events`, { name: 'x' }), ['owner', 'organizer']],
        ['list guests', (c) => c.get(`${ev}/guests`), ['owner', 'organizer', 'planner']],
        ['create guest', (c) => c.post(`${ev}/guests`, { displayName: `P ${randomUUID()}` }), ['owner', 'organizer', 'planner']],
        ['dashboard', (c) => c.get(`${f.base()}/dashboard`), ['owner', 'organizer', 'planner', 'readonly']],
        ['non-responders', (c) => c.get(`${f.base()}/non-responders`), ['owner', 'organizer', 'planner']],
        ['catering', (c) => c.get(`${f.base()}/catering`), ['owner', 'organizer', 'planner', 'readonly', 'caterer']],
        ['campaign create', (c) => c.post(`${f.base()}/campaigns`, { name: 'c', kind: 'reminder' }), ['owner', 'organizer', 'planner']],
        ['check-in search', (c) => c.get(`${f.base()}/checkin/search?q=gu`), ['owner', 'organizer', 'planner', 'checkin_staff']],
        ['members list', (c) => c.get(`${WS(f.owner)}/members`), ['owner', 'organizer']],
        ['audit log', (c) => c.get(`${WS(f.owner)}/audit-logs`), ['owner', 'organizer']],
        ['suppressions', (c) => c.get(`${WS(f.owner)}/suppressions`), ['owner', 'organizer']],
        ['workspace settings', (c) => c.patch(WS(f.owner), { name: 'Fixture Weddings' }), ['owner']],
        ['data requests', (c) => c.get(`${WS(f.owner)}/data-requests`), ['owner']],
        ['test inbox', (c) => c.get(`${WS(f.owner)}/test-inbox`), ['owner', 'organizer']],
      ];
      const actors: Record<string, Client> = { owner: f.owner };
      for (const role of ROLES.filter((r) => r !== 'owner')) actors[role] = await addMember(f, role, { events: [f.eventId] });
      const failures: string[] = [];
      for (const [name, call, allowed] of probes) {
        for (const role of ROLES) {
          const s = (await call(actors[role])).status;
          const ok = allowed.includes(role) ? s >= 200 && s < 300 : s === 403;
          if (!ok) failures.push(`${role} -> ${name}: got ${s}, expected ${allowed.includes(role) ? '2xx' : '403'}`);
        }
      }
      expect(failures).toEqual([]);
    });
    it('scoped roles cannot reach events they are not assigned to (404, no existence leak)', async () => {
      const f = await makeFixture(t.app);
      const other = await f.owner.post(`${WS(f.owner)}/events`, { name: 'Other event' });
      const planner = await addMember(f, 'planner', { events: [f.eventId] });
      expect((await planner.get(`${WS(f.owner)}/events/${f.eventId}`)).status).toBe(200);
      expect((await planner.get(`${WS(f.owner)}/events/${other.body.id}`)).status).toBe(404);
      expect((await planner.get(`${WS(f.owner)}/events`)).body.data.map((e: any) => e.id)).toEqual([f.eventId]);
    });
    it('removing a member revokes access immediately and the last owner cannot be removed or demoted', async () => {
      const f = await makeFixture(t.app);
      const org = await addMember(f, 'organizer');
      expect((await org.get(`${WS(f.owner)}/events`)).status).toBe(200);
      expect((await f.owner.del(`${WS(f.owner)}/members/${org.userId}`)).status).toBe(204);
      expect((await org.get(`${WS(f.owner)}/events`)).status).toBe(404);
      expect((await f.owner.del(`${WS(f.owner)}/members/${f.owner.userId}`)).body.error.code).toBe('LAST_OWNER');
      expect((await f.owner.patch(`${WS(f.owner)}/members/${f.owner.userId}`, { role: 'planner' })).body.error.code).toBe('LAST_OWNER');
    });
    it('audit log is readable by owners, append-only at the database level, and never contains contact data or tokens', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { name: 'Audited', phone: '+919002000025', email: 'audited@example.test' });
      const tok = (await invitationFor(f, g.guestId)).token;
      const log = await f.owner.get(`${WS(f.owner)}/audit-logs?limit=200`);
      expect(log.status).toBe(200);
      expect(log.body.data.length).toBeGreaterThan(3);
      expect(JSON.stringify(log.body)).not.toMatch(/9002000025|audited@example|Audited/);
      expect(JSON.stringify(log.body)).not.toContain(tok);
      await expect(t.db.query(`UPDATE audit_logs SET action='x' WHERE workspace_id=$1`, [f.owner.workspaceId])).rejects.toThrow(
        /append-only/,
      );
      await expect(t.db.query(`DELETE FROM audit_logs WHERE workspace_id=$1`, [f.owner.workspaceId])).rejects.toThrow(/append-only/);
    });
  });

  describe('sessions, CSRF and abuse protection', () => {
    it('logout invalidates the session server-side', async () => {
      const u = await Client.register(t.app, { workspaceName: 'Logout WS' });
      expect((await u.get('/v1/auth/me')).status).toBe(200);
      expect((await u.post('/v1/auth/logout')).status).toBe(204);
      expect((await u.get('/v1/auth/me')).status).toBe(401);
    });
    it('rejects cross-origin mutations and forged CSRF tokens', async () => {
      const u = await Client.register(t.app, { workspaceName: 'CSRF WS' });
      const evil = await u.post('/v1/workspaces', { name: 'x' }, { Origin: 'https://evil.example' });
      expect(evil.body.error.code).toBe('CSRF_ORIGIN_DENIED');
      u.csrf = 'forged';
      expect((await u.post('/v1/workspaces', { name: 'x' })).body.error.code).toBe('CSRF_TOKEN_INVALID');
    });
    it('login does not reveal whether an email exists, rotates sessions, and is rate limited', async () => {
      const t2 = await createTestApp({ RATE_LIMIT_LOGIN_PER_MIN: '4' });
      try {
        const reg = await Client.register(t2.app, { email: `rl-${randomUUID()}@example.test` });
        const bad = await request(t2.app.getHttpServer()).post('/v1/auth/login').send({ email: reg.email, password: 'wrong-password-1' });
        const unknown = await request(t2.app.getHttpServer())
          .post('/v1/auth/login')
          .send({ email: 'nobody@example.test', password: 'wrong-password-1' });
        expect(bad.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(bad.body.error.message).toBe(unknown.body.error.message);
        const ok = await request(t2.app.getHttpServer())
          .post('/v1/auth/login')
          .send({ email: reg.email, password: 'Correct-Horse-Battery-9' });
        expect(ok.status).toBe(200);
        expect(ok.headers['set-cookie'][0]).not.toContain(reg.cookie.split('=')[1]);
        let last = 0;
        for (let i = 0; i < 6; i++)
          last = (await request(t2.app.getHttpServer()).post('/v1/auth/login').send({ email: reg.email, password: 'wrong-password-1' }))
            .status;
        expect(last).toBe(429);
      } finally {
        await t2.close();
      }
    });
    it('rejects weak passwords and stores only a salted hash', async () => {
      const weak = await request(t.app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: `w-${randomUUID()}@example.test`, password: 'short', displayName: 'W' });
      expect(weak.status).toBe(422);
      const email = `h-${randomUUID()}@example.test`;
      await request(t.app.getHttpServer()).post('/v1/auth/register').send({ email, password: 'Another-Strong-Pass-77', displayName: 'H' });
      const row = await t.db.one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE email=$1`, [email]);
      expect(row!.password_hash).toMatch(/^scrypt\$/);
      expect(row!.password_hash).not.toContain('Another-Strong-Pass-77');
    });
    it('sets security headers and never caches API responses', async () => {
      const r = await request(t.app.getHttpServer()).get('/v1/health');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-security-policy']).toContain("default-src 'none'");
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['x-powered-by']).toBeUndefined();
      const big = await request(t.app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'a'.repeat(1_200_000) });
      expect(big.status).toBe(413);
    });
  });
  void idem;
});
