import { randomUUID } from 'crypto';
import request from 'supertest';
import { Client, createTestApp, idem, TestCtx } from './helpers';
import { addGuest, invitationFor, makeFixture, WS } from './fixtures';
import { DispatcherService } from '../src/messaging/dispatcher.service';
import { ProviderFactory } from '../src/messaging/provider';

/**
 * Regression tests for findings from the production audit (S1-S8, B1-B8). Each test fails on the pre-fix code.
 */
describe('audit regressions: authorization, validation, races, rate limiting', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  describe('S2: function-scoped members cannot use event-level guest routes', () => {
    it('hides guests, contacts and writes from a planner assigned only to one function', async () => {
      const f = await makeFixture(t.app);
      const onlyWedding = await addGuest(f, {
        name: 'Wedding Only',
        phone: '+919123456780',
        email: 'w@example.test',
        invite: { Wedding: 4 },
      });
      const planner = await Client.register(t.app, { name: 'Scoped Planner' });
      expect((await f.owner.post(`${WS(f.owner)}/members`, { email: planner.email, role: 'planner' })).status).toBe(201);
      const asg = await f.owner.put(`${WS(f.owner)}/members/${planner.userId}/assignments`, { eventIds: [], functionIds: [f.fn.Mehendi] });
      expect(asg.status).toBe(200);
      const P = (rest: string) => `${WS(f.owner)}/events/${f.eventId}${rest}`;

      // Function-level routes still enforce the function assignment (unchanged, correct).
      expect((await planner.get(P(`/functions/${f.fn.Wedding}`))).status).toBe(404);
      expect((await planner.get(P(`/functions/${f.fn.Mehendi}`))).status).toBe(200);
      // Event-level guest routes must now be closed to a function-only assignment.
      expect((await planner.get(P('/guests'))).status).toBe(404);
      expect((await planner.get(P(`/guests/${onlyWedding.guestId}?reveal=true`))).status).toBe(404);
      expect((await planner.patch(P(`/guests/${onlyWedding.guestId}`), { displayName: 'Tampered' })).status).toBe(404);
      expect(
        (
          await planner.post(P('/consents'), {
            guestIds: [onlyWedding.guestId],
            channel: 'whatsapp',
            basis: 'organizer_attestation',
            evidenceNote: 'x'.repeat(10),
          })
        ).status,
      ).toBe(404);
      expect((await planner.get(P('/guest-groups'))).status).toBe(404);
      const intact = await f.owner.get(P(`/guests/${onlyWedding.guestId}`));
      expect(intact.body.displayName).toBe('Wedding Only');
    });
    it('still lets an event-wide planner work with guests', async () => {
      const f = await makeFixture(t.app);
      await addGuest(f, { name: 'Visible Guest' });
      const planner = await Client.register(t.app);
      await f.owner.post(`${WS(f.owner)}/members`, { email: planner.email, role: 'planner' });
      await f.owner.put(`${WS(f.owner)}/members/${planner.userId}/assignments`, { eventIds: [f.eventId], functionIds: [] });
      const r = await planner.get(`${WS(f.owner)}/events/${f.eventId}/guests`);
      expect(r.status).toBe(200);
      expect(r.body.data.length).toBe(1);
    });
  });

  describe('B1: impossible calendar dates are rejected, not a 500', () => {
    it('returns 422 on create and update', async () => {
      const f = await makeFixture(t.app);
      for (const startDate of ['2026-02-31', '2026-13-45', '2027-02-29']) {
        const r = await f.owner.post(`${WS(f.owner)}/events`, { name: 'Bad', startDate });
        expect(r.status).toBe(422);
      }
      const upd = await f.owner.patch(`${WS(f.owner)}/events/${f.eventId}`, { endDate: '2027-04-31' });
      expect(upd.status).toBe(422);
      expect((await f.owner.post(`${WS(f.owner)}/events`, { name: 'Leap', startDate: '2028-02-29' })).status).toBe(201);
    });
  });

  describe('B2: concurrent creation with the same new group label', () => {
    it('never fails and creates exactly one group', async () => {
      const f = await makeFixture(t.app);
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          f.owner.post(`${WS(f.owner)}/events/${f.eventId}/guests`, {
            displayName: `Racer ${i}`,
            groupLabel: 'Sharma Family',
            allowDuplicate: true,
          }),
        ),
      );
      expect(results.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
      const g = await f.owner.get(`${WS(f.owner)}/events/${f.eventId}/guest-groups`);
      const groups: any[] = Array.isArray(g.body) ? g.body : g.body.data;
      expect(groups.filter((x) => x.label === 'Sharma Family').length).toBe(1);
      const same = await Promise.all(
        Array.from({ length: 20 }, () => f.owner.post(`${WS(f.owner)}/events/${f.eventId}/guest-groups`, { label: 'Mehta Family' })),
      );
      expect(same.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    });
  });

  describe('B3: exported CSV can be imported again', () => {
    it('round-trips phone numbers', async () => {
      const f = await makeFixture(t.app);
      await addGuest(f, { name: 'Phone Guest', phone: '+919811122233', email: 'pg@example.test' });
      const ex = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/exports`, { kind: 'guests' });
      expect(ex.status).toBeLessThan(300);
      const dl = await f.owner.get(ex.body.downloadPath);
      const csv = dl.text as string;
      expect(csv).toContain("'+919811122233"); // formula guard still present in the file
      const pv = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/imports/preview`, { csv });
      expect(pv.status).toBeLessThan(300);
      expect(pv.body.summary.errors).toBe(0);
      // The phone parsed fine; the guest already exists, so it is reported as a duplicate rather than a phone error.
      expect(pv.body.summary.valid + pv.body.summary.duplicates).toBe(1);
    });
  });

  describe('S5: weak passwords', () => {
    it('rejects trivially guessable passwords at registration', async () => {
      for (const password of ['aaaaaaaaaa', '1234567890', 'abababababab', 'Password123!']) {
        const r = await request(t.app.getHttpServer())
          .post('/v1/auth/register')
          .send({ email: `weak-${randomUUID()}@example.test`, password, displayName: 'W' });
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe('WEAK_PASSWORD');
      }
    });
  });

  describe('S4: audit log cannot be flooded by probing workspace ids', () => {
    it('throttles denied-access audit rows per user', async () => {
      const c = await Client.register(t.app);
      await Promise.all(Array.from({ length: 60 }, () => c.get(`/v1/workspaces/${randomUUID()}/events`)));
      const rows = await t.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE action='security.workspace_access_denied' AND actor_user_id=$1`,
        [c.userId],
      );
      expect(rows[0].n).toBeLessThanOrEqual(20);
      expect(rows[0].n).toBeGreaterThan(0);
    });
  });

  describe('B5: check-in tells staff who was scanned', () => {
    it('returns the guest name and, for unconfirmed RSVPs, what is needed to confirm manually', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { name: 'Door Guest', invite: { Mehendi: 3 } });
      const inv = await invitationFor(f, g.guestId);
      const blocked = await f.owner.post(`${f.base()}/checkin`, { invitationId: inv.id }, idem());
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('RSVP_NOT_CONFIRMED');
      expect(blocked.body.error.invitationId).toBe(inv.id);
      expect(blocked.body.error.guestName).toBe('Door Guest');
      expect(blocked.body.error.partySize).toBe(3);
      const ok = await f.owner.post(
        `${f.base()}/checkin`,
        { invitationId: inv.id, allowUnconfirmed: true, adults: 2, children: 0 },
        idem(),
      );
      expect(ok.status).toBe(201);
      expect(ok.body.guestName).toBe('Door Guest');
    });
  });

  describe('B8: database pool resilience', () => {
    it('has an error listener so an idle-connection error cannot crash the process', () => {
      expect(t.db.pool.listenerCount('error')).toBeGreaterThanOrEqual(1);
      expect((t.db.pool.options as any).connectionTimeoutMillis).toBeGreaterThan(0);
    });
  });
});

describe('audit regressions: rate limiting per real client (S1, S3, S4)', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp({
      TRUST_PROXY: '1',
      RATE_LIMIT_PUBLIC_INVALID_PER_MIN: '3',
      RATE_LIMIT_PUBLIC_PER_MIN: '1000',
      RATE_LIMIT_LOGIN_PER_MIN: '5',
      RATE_LIMIT_LOGIN_EMAIL_PER_MIN: '1000',
      RATE_LIMIT_USER_PER_MIN: '100000',
    });
  });
  afterAll(async () => {
    await t.close();
  });
  const view = (token: string, ip: string) => request(t.app.getHttpServer()).get(`/v1/public/rsvp/${token}`).set('X-Forwarded-For', ip);

  it('S1: one abusive client no longer blocks other guests behind the proxy', async () => {
    const f = await makeFixture(t.app, {});
    const g = await addGuest(f, { name: 'Real Guest' });
    const { token } = await invitationFor(f, g.guestId);
    for (let i = 0; i < 3; i++) expect((await view('A'.repeat(43), '198.51.100.9')).status).toBe(404);
    expect((await view('A'.repeat(43), '198.51.100.9')).status).toBe(429); // the abuser is limited...
    expect((await view(token, '203.0.113.77')).status).toBe(200); // ...a different guest is not
  });

  it('S3: hammering a victim email from one address does not lock the victim out from theirs', async () => {
    const victim = await Client.register(t.app);
    const login = (email: string, password: string, ip: string) =>
      request(t.app.getHttpServer()).post('/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await login(victim.email, 'wrong-password-' + i, '198.51.100.20')).status);
    expect(statuses).toContain(429); // attacker is throttled
    expect((await login(victim.email, 'Correct-Horse-Battery-9', '192.0.2.55')).status).toBe(200); // victim is fine
  });
});

describe('audit regressions: per-account ceiling (S4)', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp({ RATE_LIMIT_USER_PER_MIN: '8' });
  });
  afterAll(async () => {
    await t.close();
  });
  it('a single account is capped per minute on authenticated routes', async () => {
    const c = await Client.register(t.app);
    const out: number[] = [];
    for (let i = 0; i < 12; i++) out.push((await c.get('/v1/auth/me')).status);
    expect(out.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(out).toContain(429);
  });
});

describe('audit regressions: messaging (S8, B6, B7)', () => {
  let t: TestCtx;
  let disp: DispatcherService;
  const NOON_IST = new Date('2027-01-15T06:30:00Z');
  beforeAll(async () => {
    t = await createTestApp();
    disp = t.app.get(DispatcherService);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.db.query(
      `UPDATE scheduled_messages SET status='cancelled', skip_reason='test_cleanup', locked_until=NULL WHERE status IN ('scheduled','queued','unknown')`,
    );
  });
  const prep = async (f: Awaited<ReturnType<typeof makeFixture>>, guestIds: string[]) => {
    await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/consents`, {
      guestIds,
      channel: 'whatsapp',
      status: 'granted',
      basis: 'organizer_attestation',
      evidenceNote: 'Guests gave number to host for wedding updates',
    });
    await f.owner.post(`${WS(f.owner)}/contact-authority-attestation`, { confirm: true });
  };
  const campaign = async (f: Awaited<ReturnType<typeof makeFixture>>, fnName: string) => {
    const r = await f.owner.post(`${f.base(fnName)}/campaigns`, { name: `blast ${fnName}`, kind: 'invitation', channel: 'whatsapp' });
    return `${f.base(fnName)}/campaigns/${r.body.id}`;
  };
  const schedule = async (f: Awaited<ReturnType<typeof makeFixture>>, url: string) => {
    const pv = await f.owner.post(`${url}/preview`);
    return f.owner.post(
      `${url}/schedule`,
      { confirmRecipientCount: pv.body.eligibleCount, confirmEstimatedCostPaise: pv.body.estimatedCostPaise },
      idem(),
    );
  };

  it('S8: two campaigns scheduled at the same moment cannot together exceed the workspace spend cap', async () => {
    const f = await makeFixture(t.app);
    const a = await addGuest(f, { name: 'Cap A', invite: { Mehendi: 1 } });
    const b = await addGuest(f, { name: 'Cap B', invite: { Wedding: 1 } });
    await prep(f, [a.guestId, b.guestId]);
    await t.db.query(`UPDATE workspaces SET message_spend_cap_paise=100 WHERE id=$1`, [f.owner.workspaceId]); // one WhatsApp message ~80 paise
    const [c1, c2] = [await campaign(f, 'Mehendi'), await campaign(f, 'Wedding')];
    const results = await Promise.all([schedule(f, c1), schedule(f, c2)]);
    const ok = results.filter((r) => r.status === 200 || r.status === 201).length;
    expect(ok).toBe(1);
  });

  it('B6: a provider that throws is retried with a bound and then dead-lettered, not looped forever', async () => {
    const f = await makeFixture(t.app);
    const g = await addGuest(f, { name: 'Poison', invite: { Mehendi: 1 } });
    await prep(f, [g.guestId]);
    const url = await campaign(f, 'Mehendi');
    expect((await schedule(f, url)).status).toBeLessThan(300);
    const factory = t.app.get(ProviderFactory);
    const spy = jest.spyOn(factory, 'get').mockReturnValue({
      name: 'fake',
      send: async () => {
        throw new Error('adapter bug');
      },
    } as any);
    try {
      for (let i = 0; i < 8; i++) await disp.runOnce(NOON_IST);
    } finally {
      spy.mockRestore();
    }
    const rows = await t.db.query<any>(
      `SELECT status, last_error_code, dead_lettered_at, attempt_count FROM scheduled_messages WHERE invitation_id IN (SELECT id FROM event_invitations WHERE guest_id=$1)`,
      [g.guestId],
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].last_error_code).toBe('DISPATCH_EXCEPTION');
    expect(rows[0].dead_lettered_at).not.toBeNull();
    expect(rows[0].attempt_count).toBeLessThanOrEqual(t.cfg.MESSAGE_MAX_ATTEMPTS);
  });

  it('B7: a cancelled message cannot be overwritten by a late failure', async () => {
    const f = await makeFixture(t.app);
    const g = await addGuest(f, { name: 'Cancelled', invite: { Mehendi: 1 } });
    await prep(f, [g.guestId]);
    const url = await campaign(f, 'Mehendi');
    await schedule(f, url);
    const [m] = await t.db.query<any>(
      `SELECT * FROM scheduled_messages WHERE invitation_id IN (SELECT id FROM event_invitations WHERE guest_id=$1)`,
      [g.guestId],
    );
    await t.db.query(`UPDATE scheduled_messages SET status='cancelled' WHERE id=$1`, [m.id]);
    const setStatus = (disp as any).setStatus.bind(disp);
    expect(await setStatus(m, 'failed', { error: 'LATE' })).toBe(false);
    expect(await setStatus(m, 'scheduled')).toBe(false);
    const [after] = await t.db.query<any>(`SELECT status FROM scheduled_messages WHERE id=$1`, [m.id]);
    expect(after.status).toBe('cancelled');
  });
});
