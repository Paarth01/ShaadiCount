import { randomUUID } from 'crypto';
import request from 'supertest';
import { Client, createTestApp, idem, TestCtx } from './helpers';
import { addGuest, invitationFor, makeFixture, WS } from './fixtures';

describe('core domain: events, guests, import, invitations, RSVP', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  const pubGet = (token: string) => request(t.app.getHttpServer()).get(`/v1/public/rsvp/${token}`);
  const pubPut = (token: string, body: unknown, key: string | null = `k-${randomUUID()}`) => {
    let r = request(t.app.getHttpServer()).put(`/v1/public/rsvp/${token}/response`);
    if (key) r = r.set('Idempotency-Key', key);
    return r.send(body as object);
  };

  describe('events and time zones', () => {
    it('stores event-local times as UTC and returns both (Asia/Kolkata = UTC+5:30)', async () => {
      const f = await makeFixture(t.app);
      const r = await f.owner.get(`${WS(f.owner)}/events/${f.eventId}/functions/${f.fn.Mehendi}`);
      expect(r.body.startsAt).toBe('2027-02-10T11:30:00.000Z');
      expect(r.body.startsAtLocal).toBe('2027-02-10T17:00');
      expect(r.body.rsvpDeadline).toBe('2027-02-05T12:30:00.000Z');
    });
    it('handles DST correctly: same 09:00 local deadline maps to different UTC offsets either side of the change', async () => {
      const f = await makeFixture(t.app);
      const ev = await f.owner.post(`${WS(f.owner)}/events`, { name: 'NJ Wedding', timezone: 'America/New_York' });
      const mk = (name: string, startsAt: string) =>
        f.owner.post(`${WS(f.owner)}/events/${ev.body.id}/functions`, { name, startsAt, rsvpDeadline: startsAt });
      const before = await mk('Before DST', '2027-03-13T09:00');
      const after = await mk('After DST', '2027-03-15T09:00');
      expect(before.body.startsAt).toBe('2027-03-13T14:00:00.000Z'); // EST UTC-5
      expect(after.body.startsAt).toBe('2027-03-15T13:00:00.000Z'); // EDT UTC-4
      expect(after.body.startsAtLocal).toBe('2027-03-15T09:00');
    });
    it('rejects unknown time zones and deadlines after the function start', async () => {
      const f = await makeFixture(t.app);
      expect((await f.owner.post(`${WS(f.owner)}/events`, { name: 'x', timezone: 'Mars/Olympus' })).body.error.code).toBe(
        'INVALID_TIMEZONE',
      );
      const bad = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/functions`, {
        name: 'Late',
        startsAt: '2027-02-10T10:00',
        rsvpDeadline: '2027-02-11T10:00',
      });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('INVALID_DEADLINE');
    });
  });

  describe('guests', () => {
    it('masks phone numbers in lists and only reveals them on an audited, authorised request', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { name: 'Meera Iyer', phone: '98765 43210' });
      const list = await f.owner.get(`${WS(f.owner)}/events/${f.eventId}/guests`);
      expect(JSON.stringify(list.body)).not.toContain('9876543210');
      expect(list.body.data[0].phoneMasked).toMatch(/^\+91•+3210$/);
      const rev = await f.owner.get(`${WS(f.owner)}/events/${f.eventId}/guests/${g.guestId}?reveal=true`);
      expect(rev.body.phone).toBe('+919876543210');
      const a = await t.db.query(`SELECT 1 FROM audit_logs WHERE resource_id=$1 AND action='guest.contact_revealed'`, [g.guestId]);
      expect(a.length).toBe(1);
    });
    it('flags likely duplicates instead of silently merging, and allows explicit override', async () => {
      const f = await makeFixture(t.app);
      await addGuest(f, { name: 'Rohan Verma', phone: '+919000011111' });
      const dup = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/guests`, { displayName: 'Rohan V', phone: '+919000011111' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('DUPLICATE_GUEST');
      const ok = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/guests`, {
        displayName: 'Rohan V',
        phone: '+919000011111',
        allowDuplicate: true,
      });
      expect(ok.status).toBe(201);
    });
    it('erases personal data on delete while revoking invitations', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { name: 'To Forget', phone: '+919000022222', email: 'forget@example.test' });
      const inv = await invitationFor(f, g.guestId);
      const del = await f.owner.del(`${WS(f.owner)}/events/${f.eventId}/guests/${g.guestId}`);
      expect(del.status).toBe(204);
      const row = await t.db.one(`SELECT display_name, phone_e164, email FROM guests WHERE id=$1`, [g.guestId]);
      expect(row).toEqual({ display_name: 'Deleted guest', phone_e164: null, email: null });
      expect((await pubGet(inv.token)).status).toBe(404);
    });
  });

  describe('partial updates never re-apply create-time defaults', () => {
    it('PATCH on a function only changes the fields that were sent', async () => {
      const f = await makeFixture(t.app, {
        Locked: { startsAt: '2027-03-02T10:00', allowChildren: false, allowResponseEdits: false, status: 'draft', capacity: 20 },
      });
      const url = `${WS(f.owner)}/events/${f.eventId}/functions/${f.fn.Locked}`;
      const r = await f.owner.patch(url, { venue: 'New hall' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ venue: 'New hall', allowChildren: false, allowResponseEdits: false, status: 'draft', capacity: 20 });
    });
    it('PATCH on a guest keeps tags and language that were not sent', async () => {
      const f = await makeFixture(t.app);
      const g = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/guests`, {
        displayName: 'Tagged Guest',
        preferredLanguage: 'hi',
        tags: ['vip', 'family'],
      });
      const r = await f.owner.patch(`${WS(f.owner)}/events/${f.eventId}/guests/${g.body.id}`, { displayName: 'Renamed Guest' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ displayName: 'Renamed Guest', language: 'hi', tags: ['vip', 'family'] });
    });
  });

  describe('CSV import', () => {
    const csv = [
      'Guest Name,Mobile,Email,Language,Family,Functions,Party Size',
      'Anita Rao,98765 00001,anita@example.test,Hindi,Rao Family,Mehendi;Wedding,3',
      'Bad Phone,12345,,English,,Mehendi,1',
      'Anita Rao Dup,9876500001,,English,,Mehendi,1',
      '"=HYPERLINK(""http://evil"")",+919876500002,,English,,Wedding,2',
      'Unknown Fn,9876500003,,English,,Sangeet,1',
    ].join('\n');

    it('previews row-level errors/duplicates, never grants messaging consent, and commits idempotently', async () => {
      const f = await makeFixture(t.app);
      const pv = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/imports/preview`, { csv });
      expect(pv.status).toBe(201);
      expect(pv.body.summary).toEqual({ totalRows: 5, valid: 2, duplicates: 1, errors: 2 });
      expect(pv.body.rows.find((r: any) => r.rowNumber === 3).errors[0].field).toBe('phone');
      expect(pv.body.rows.find((r: any) => r.rowNumber === 4).duplicateOf.reason).toBe('phone_repeated_in_file');
      expect(JSON.stringify(pv.body)).not.toContain('9876500001'); // masked in preview

      const key = idem();
      const c1 = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/imports/${pv.body.importId}/commit`, {}, key);
      expect(c1.status).toBe(201);
      expect(c1.body).toMatchObject({
        created: 2,
        invitationsCreated: 3,
        skippedDuplicates: 1,
        skippedErrors: 2,
        messagingAuthorized: false,
      });
      const c2 = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/imports/${pv.body.importId}/commit`, {}, key);
      expect(c2.body).toEqual(c1.body);
      expect(c2.headers['idempotent-replayed']).toBe('true');
      const guests = await t.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM guests WHERE event_id=$1`, [f.eventId]);
      expect(guests!.c).toBe(2);
      const consents = await t.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM communication_consents WHERE event_id=$1`, [
        f.eventId,
      ]);
      expect(consents!.c).toBe(0);
      const raw = await t.db.one<{ raw_csv: string | null }>(`SELECT raw_csv FROM import_jobs WHERE id=$1`, [pv.body.importId]);
      expect(raw!.raw_csv).toBeNull(); // source file purged after commit
    });
    it('includes a duplicate only when the organizer explicitly selects its row', async () => {
      const f = await makeFixture(t.app);
      const pv = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/imports/preview`, { csv });
      const c = await f.owner.post(
        `${WS(f.owner)}/events/${f.eventId}/imports/${pv.body.importId}/commit`,
        { includeDuplicateRows: [4] },
        idem(),
      );
      expect(c.body.created).toBe(3);
    });
    it('accepts a large (~150 KB) CSV on the import route even though other routes cap bodies at 100 KB', async () => {
      const f = await makeFixture(t.app);
      const rows = ['name,mobile,family'];
      for (let i = 0; i < 3000; i++) rows.push(`Guest Number ${i},9${String(100000000 + i * 7).slice(0, 9)},Family ${i % 40}`);
      const csv = rows.join('\n');
      expect(Buffer.byteLength(csv)).toBeGreaterThan(100_000);
      const pv = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/imports/preview`, { csv });
      expect(pv.status).toBe(201);
      expect(pv.body.summary.totalRows).toBe(3000);
      const tooBig = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/guests`, { displayName: 'x'.repeat(150_000) });
      expect(tooBig.status).toBe(413);
    });
    it('requires an Idempotency-Key and rejects malformed CSV with a clear error', async () => {
      const f = await makeFixture(t.app);
      const pv = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/imports/preview`, { csv });
      expect((await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/imports/${pv.body.importId}/commit`, {})).body.error.code).toBe(
        'IDEMPOTENCY_KEY_REQUIRED',
      );
      const bad = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/imports/preview`, { csv: 'Name,Phone\n"unterminated,1' });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('CSV_INVALID');
    });
  });

  describe('invitation tokens and public RSVP', () => {
    it('stores only a hash of the token and serves minimal guest-facing data', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { name: 'Kabir Shah', phone: '+919000033333', invite: { Mehendi: 4 } });
      const inv = await invitationFor(f, g.guestId);
      expect(inv.token).toHaveLength(43);
      const stored = await t.db.one<{ token_hash: string }>(`SELECT token_hash FROM event_invitations WHERE id=$1`, [inv.id]);
      expect(stored!.token_hash).not.toBe(inv.token);
      expect(stored!.token_hash).toMatch(/^[0-9a-f]{64}$/);
      const v = await pubGet(inv.token);
      expect(v.status).toBe(200);
      expect(v.body).toMatchObject({ guestName: 'Kabir Shah', partySizeMax: 4, state: 'open', response: null, checkinCode: null });
      expect(JSON.stringify(v.body)).not.toMatch(/9000033333|phone|email/i);
      expect(v.headers['x-robots-tag']).toContain('noindex');
      expect(v.headers['cache-control']).toBe('no-store');
    });
    it('is limited to the invited function: a token for Mehendi never exposes Wedding', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { invite: { Mehendi: 2, Wedding: 2 } });
      const m = await invitationFor(f, g.guestId, 'Mehendi');
      const w = await invitationFor(f, g.guestId, 'Wedding');
      expect(m.token).not.toBe(w.token);
      expect((await pubGet(m.token)).body.function.name).toBe('Mehendi');
      expect((await pubGet(w.token)).body.function.name).toBe('Wedding');
    });
    it('records Yes with adult/child counts, enforces party size & child policy, and issues a check-in code', async () => {
      const f = await makeFixture(t.app, { 'Adults Only': { startsAt: '2027-02-11T20:00', allowChildren: false } });
      const g = await addGuest(f, { invite: { Mehendi: 4, 'Adults Only': 3 } });
      const m = await invitationFor(f, g.guestId, 'Mehendi');
      const tooMany = await pubPut(m.token, { status: 'yes', adultCount: 3, childCount: 2, version: 0 });
      expect(tooMany.status).toBe(422);
      expect(tooMany.body.error.code).toBe('PARTY_SIZE_EXCEEDED');
      const ok = await pubPut(m.token, { status: 'yes', adultCount: 2, childCount: 2, version: 0 });
      expect(ok.status).toBe(201);
      expect(ok.body.response).toMatchObject({ status: 'yes', adultCount: 2, childCount: 2, version: 1 });
      expect(ok.body.checkinCode).toMatch(/^[A-Z2-9]{12}$/);
      const a = await invitationFor(f, g.guestId, 'Adults Only');
      const kids = await pubPut(a.token, { status: 'yes', adultCount: 1, childCount: 1, version: 0 });
      expect(kids.body.error.code).toBe('CHILDREN_NOT_ALLOWED');
    });
    it('treats "No" as zero people and "Maybe" as provisional', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { invite: { Mehendi: 3 } });
      const m = await invitationFor(f, g.guestId);
      const no = await pubPut(m.token, { status: 'no', adultCount: 5, childCount: 5, version: 0 });
      expect(no.body.response).toMatchObject({ status: 'no', adultCount: 0, childCount: 0 });
      const maybe = await pubPut(m.token, { status: 'maybe', adultCount: 2, childCount: 0, version: 1 });
      expect(maybe.status).toBe(200);
      expect(maybe.body.response).toMatchObject({ status: 'maybe', adultCount: 2, version: 2 });
    });
    it('replays an identical retry without a second write, and rejects key reuse with a different body', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f);
      const m = await invitationFor(f, g.guestId);
      const key = `k-${randomUUID()}`;
      const a = await pubPut(m.token, { status: 'yes', adultCount: 1, childCount: 0, version: 0 }, key);
      const b = await pubPut(m.token, { status: 'yes', adultCount: 1, childCount: 0, version: 0 }, key);
      expect(b.status).toBe(a.status);
      expect(b.body).toEqual(a.body);
      expect(b.headers['idempotent-replayed']).toBe('true');
      const h = await t.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM rsvp_response_history WHERE invitation_id=$1`, [m.id]);
      expect(h!.c).toBe(1);
      const reuse = await pubPut(m.token, { status: 'no', adultCount: 0, childCount: 0, version: 0 }, key);
      expect(reuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((await pubPut(m.token, { status: 'yes', adultCount: 1, childCount: 0, version: 1 }, null)).body.error.code).toBe(
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    });
    it('serialises concurrent edits: stale version loses with 409 and the latest answer is returned', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { invite: { Mehendi: 4 } });
      const m = await invitationFor(f, g.guestId);
      await pubPut(m.token, { status: 'yes', adultCount: 1, childCount: 0, version: 0 });
      const [x, y] = await Promise.all([
        pubPut(m.token, { status: 'yes', adultCount: 2, childCount: 0, version: 1 }),
        pubPut(m.token, { status: 'no', adultCount: 0, childCount: 0, version: 1 }),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      const loser = x.status === 409 ? x : y;
      expect(loser.body.error.code).toBe('VERSION_CONFLICT');
      expect(loser.body.error.current.version).toBe(2);
    });
    it('closes responses after the deadline and when edits are disabled', async () => {
      const f = await makeFixture(t.app, {
        Past: { startsAt: '2020-01-02T10:00', rsvpDeadline: '2020-01-01T10:00' },
        Locked: { startsAt: '2027-03-02T10:00', allowResponseEdits: false },
      });
      const g = await addGuest(f, { invite: { Past: 2, Locked: 2 } });
      const past = await invitationFor(f, g.guestId, 'Past');
      expect((await pubGet(past.token)).body.state).toBe('closed_deadline');
      expect((await pubPut(past.token, { status: 'yes', adultCount: 1, childCount: 0, version: 0 })).body.error.code).toBe(
        'RSVP_DEADLINE_PASSED',
      );
      const locked = await invitationFor(f, g.guestId, 'Locked');
      expect((await pubPut(locked.token, { status: 'yes', adultCount: 1, childCount: 0, version: 0 })).status).toBe(201);
      expect((await pubPut(locked.token, { status: 'no', adultCount: 0, childCount: 0, version: 1 })).body.error.code).toBe(
        'RESPONSE_EDITS_DISABLED',
      );
    });
    it('revocation and rotation immediately invalidate old links', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f);
      const m = await invitationFor(f, g.guestId);
      const rot = await f.owner.post(`${f.base()}/invitations/${m.id}/rotate-token`, { reason: 'link leaked in group chat' });
      expect((await pubGet(m.token)).status).toBe(404);
      const newToken = (rot.body.link as string).split('#')[1];
      expect((await pubGet(newToken)).status).toBe(200);
      await f.owner.post(`${f.base()}/invitations/${m.id}/revoke`, { reason: 'withdrawn' });
      const gone = await pubGet(newToken);
      expect(gone.status).toBe(410);
      expect(gone.body.error.code).toBe('INVITATION_UNAVAILABLE');
    });
    it('returns identical 404s for malformed and unknown tokens and rate-limits repeated guessing', async () => {
      const t2 = await createTestApp({ RATE_LIMIT_PUBLIC_INVALID_PER_MIN: '5' });
      try {
        const a = await request(t2.app.getHttpServer()).get('/v1/public/rsvp/short');
        const b = await request(t2.app.getHttpServer()).get(`/v1/public/rsvp/${'A'.repeat(43)}`);
        expect(a.status).toBe(404);
        expect(b.status).toBe(404);
        expect(a.body.error.message).toBe(b.body.error.message);
        let last = 0;
        for (let i = 0; i < 8; i++) last = (await request(t2.app.getHttpServer()).get(`/v1/public/rsvp/${'B'.repeat(43)}`)).status;
        expect(last).toBe(429);
      } finally {
        await t2.close();
      }
    });
  });

  describe('organizer corrections', () => {
    it('requires a reason, records actor/history, and can exceed party size only explicitly (trigger backs this up)', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f, { invite: { Mehendi: 2 } });
      const m = await invitationFor(f, g.guestId);
      const url = `${f.base()}/invitations/${m.id}/response`;
      expect((await f.owner.put(url, { status: 'yes', adultCount: 2, childCount: 0 })).status).toBe(422);
      const ok = await f.owner.put(url, { status: 'yes', adultCount: 2, childCount: 0, reason: 'Guest phoned the host' });
      expect(ok.body).toMatchObject({ status: 'yes', adultCount: 2, version: 1 });
      const exceed = await f.owner.put(url, { status: 'yes', adultCount: 4, childCount: 0, reason: 'Host approved extra seats' });
      expect(exceed.body.error.code).toBe('PARTY_SIZE_EXCEEDED');
      const allowed = await f.owner.put(url, {
        status: 'yes',
        adultCount: 4,
        childCount: 0,
        reason: 'Host approved extra seats',
        allowExceedPartySize: true,
      });
      expect(allowed.body.adultCount).toBe(4);
      const hist = await f.owner.get(`${f.base()}/invitations/${m.id}/history`);
      expect(hist.body.data).toHaveLength(2);
      expect(hist.body.data[1]).toMatchObject({ actorType: 'organizer', isOverride: true, reason: 'Host approved extra seats' });
      const aud = await t.db.query(`SELECT 1 FROM audit_logs WHERE resource_id=$1 AND action='rsvp.overridden'`, [m.id]);
      expect(aud.length).toBe(2);
      await expect(
        t.db.query(`UPDATE rsvp_responses SET adult_count=40, override_reason=NULL, override_by=NULL WHERE invitation_id=$1`, [m.id]),
      ).rejects.toThrow(/party size/);
      await expect(t.db.query(`UPDATE rsvp_response_history SET reason='tamper' WHERE invitation_id=$1`, [m.id])).rejects.toThrow(
        /append-only/,
      );
    });
  });

  describe('tenant isolation', () => {
    it("never resolves another workspace's event/function/invitation even with a valid own workspace id", async () => {
      const a = await makeFixture(t.app);
      const b = await makeFixture(t.app);
      const g = await addGuest(a);
      const inv = await invitationFor(a, g.guestId);
      expect((await b.owner.get(`${WS(b.owner)}/events/${a.eventId}`)).status).toBe(404);
      expect((await b.owner.get(`${WS(b.owner)}/events/${b.eventId}/functions/${a.fn.Mehendi}`)).status).toBe(404);
      expect((await b.owner.get(`${WS(b.owner)}/events/${b.eventId}/guests/${g.guestId}`)).status).toBe(404);
      expect((await b.owner.get(`${WS(b.owner)}/events/${a.eventId}/guests`)).status).toBe(404);
      expect(
        (
          await b.owner.put(`${WS(b.owner)}/events/${b.eventId}/functions/${b.fn.Mehendi}/invitations/${inv.id}/response`, {
            status: 'no',
            reason: 'attack attempt',
          })
        ).status,
      ).toBe(404);
      const list = await b.owner.get(`${WS(b.owner)}/events`);
      expect(list.body.data.map((e: any) => e.id)).not.toContain(a.eventId);
    });
    it('composite foreign keys stop cross-workspace rows even from buggy SQL', async () => {
      const a = await makeFixture(t.app);
      const b = await makeFixture(t.app);
      const g = await addGuest(a);
      await expect(
        t.db.query(
          `INSERT INTO event_invitations (workspace_id,event_id,event_function_id,guest_id,invited_party_size,token_hash,checkin_code_hash)
         VALUES ($1,$2,$3,$4,1,$5,$6)`,
          [b.owner.workspaceId, b.eventId, b.fn.Mehendi, g.guestId, randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow(/foreign key/);
    });
  });
  void Client;
});
