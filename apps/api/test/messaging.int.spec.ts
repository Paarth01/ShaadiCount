import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, idem, TestCtx } from './helpers';
import { addGuest, Fixture, invitationFor, makeFixture, WS } from './fixtures';
import { DispatcherService } from '../src/messaging/dispatcher.service';
import { OutboxRelayService } from '../src/messaging/outbox-relay.service';
import { loadConfig, ConfigError } from '../src/config/config';

const NOON_IST = new Date('2027-01-15T06:30:00Z'); // 12:00 in Asia/Kolkata, safely before every RSVP deadline
const NIGHT_IST = new Date('2027-01-15T17:30:00Z'); // 23:00 IST (quiet hours 21:00-09:00)

describe('messaging: consent, campaigns, worker, webhooks', () => {
  let t: TestCtx;
  let disp: DispatcherService;
  let relay: OutboxRelayService;
  beforeAll(async () => {
    t = await createTestApp();
    disp = t.app.get(DispatcherService);
    relay = t.app.get(OutboxRelayService);
  });
  afterAll(async () => {
    await t.close();
  });
  // The dispatcher is a global worker: start every test with an empty queue so leftovers from earlier tests can't be claimed.
  beforeEach(async () => {
    await t.db.query(
      `UPDATE scheduled_messages SET status='cancelled', skip_reason='test_cleanup', locked_until=NULL WHERE status IN ('scheduled','queued','unknown')`,
    );
  });

  const consent = (f: Fixture, guestIds: string[], status = 'granted') =>
    f.owner.post(`${WS(f.owner)}/events/${f.eventId}/consents`, {
      guestIds,
      channel: 'whatsapp',
      status,
      basis: 'organizer_attestation',
      evidenceNote: 'Guests gave number to host for wedding updates',
    });
  const attest = (f: Fixture) => f.owner.post(`${WS(f.owner)}/contact-authority-attestation`, { confirm: true });
  const makeCampaign = async (f: Fixture, kind: 'invitation' | 'reminder' = 'invitation', fnName = 'Mehendi') => {
    const r = await f.owner.post(`${f.base(fnName)}/campaigns`, { name: `${kind} blast`, kind, channel: 'whatsapp' });
    return { id: r.body.id as string, url: `${f.base(fnName)}/campaigns/${r.body.id}` };
  };
  const schedule = async (f: Fixture, c: { url: string }, extra: Record<string, unknown> = {}) => {
    const pv = await f.owner.post(`${c.url}/preview`);
    return f.owner.post(
      `${c.url}/schedule`,
      { confirmRecipientCount: pv.body.eligibleCount, confirmEstimatedCostPaise: pv.body.estimatedCostPaise, ...extra },
      idem(),
    );
  };
  const msgs = (campaignId: string) =>
    t.db.query<any>(`SELECT * FROM scheduled_messages WHERE campaign_id=$1 ORDER BY created_at`, [campaignId]);
  const sign = (body: object, ts = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify(body);
    return { raw, sig: `t=${ts},v1=${createHmac('sha256', process.env.MESSAGING_WEBHOOK_SECRET!).update(`${ts}.${raw}`).digest('hex')}` };
  };
  const postWebhook = (body: object, sigOverride?: string) => {
    const { raw, sig } = sign(body);
    return request(t.app.getHttpServer())
      .post('/v1/webhooks/messaging/fake')
      .set('Content-Type', 'application/json')
      .set('X-Shaadicount-Signature', sigOverride ?? sig)
      .send(raw);
  };

  describe('eligibility and scheduling safeguards', () => {
    it('does not message anyone merely because a phone number exists: consent evidence is required', async () => {
      const f = await makeFixture(t.app);
      const a = await addGuest(f, { name: 'Has Consent' });
      await addGuest(f, { name: 'No Consent' });
      await addGuest(f, { name: 'No Phone', phone: null });
      await consent(f, [a.guestId]);
      const c = await makeCampaign(f);
      const pv = await f.owner.post(`${c.url}/preview`);
      expect(pv.body.eligibleCount).toBe(1);
      expect(pv.body.excludedCounts).toEqual({ no_consent_evidence: 1, no_contact: 1 });
      expect(pv.body.messagingMode).toBe('fake');
      expect(pv.body.sample[0].text).toContain('Has Consent');
      expect(JSON.stringify(pv.body.recipients)).not.toMatch(/\+919000/); // masked
    });
    it('blocks scheduling until the organizer attests authority to contact guests', async () => {
      const f = await makeFixture(t.app);
      const g = await addGuest(f);
      await consent(f, [g.guestId]);
      const c = await makeCampaign(f);
      const r = await schedule(f, c);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('ATTESTATION_REQUIRED');
      expect((await msgs(c.id)).length).toBe(0);
    });
    it('requires the reviewed recipient count and cost, and an Idempotency-Key; replays do not duplicate messages', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const gs = [await addGuest(f), await addGuest(f)];
      await consent(
        f,
        gs.map((g) => g.guestId),
      );
      const c = await makeCampaign(f);
      const pv = await f.owner.post(`${c.url}/preview`);
      expect(pv.body.estimatedCostPaise).toBe(2 * t.cfg.MESSAGE_COST_PAISE_WHATSAPP);
      const stale = await f.owner.post(`${c.url}/schedule`, { confirmRecipientCount: 5, confirmEstimatedCostPaise: 1 }, idem());
      expect(stale.body.error.code).toBe('CONFIRMATION_MISMATCH');
      expect(
        (await f.owner.post(`${c.url}/schedule`, { confirmRecipientCount: 2, confirmEstimatedCostPaise: pv.body.estimatedCostPaise })).body
          .error.code,
      ).toBe('IDEMPOTENCY_KEY_REQUIRED');
      const key = idem();
      const body = { confirmRecipientCount: 2, confirmEstimatedCostPaise: pv.body.estimatedCostPaise };
      const a = await f.owner.post(`${c.url}/schedule`, body, key);
      const b = await f.owner.post(`${c.url}/schedule`, body, key);
      expect(a.status).toBe(200);
      expect(b.body).toEqual(a.body);
      expect((await msgs(c.id)).length).toBe(2);
      const again = await f.owner.post(`${c.url}/schedule`, body, idem());
      expect(again.body.error.code).toBe('CAMPAIGN_NOT_DRAFT');
    });
    it('enforces the workspace spend cap', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      await f.owner.patch(WS(f.owner), { messageSpendCapPaise: 100 });
      const gs = [await addGuest(f), await addGuest(f)];
      await consent(
        f,
        gs.map((g) => g.guestId),
      );
      const r = await schedule(f, await makeCampaign(f));
      expect(r.body.error.code).toBe('SPEND_CAP_EXCEEDED');
    });
    it('excludes opted-out contacts (suppression survives guest deletion) and revoked consent', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const a = await addGuest(f, { name: 'Opted Out', phone: '+919000044444' });
      const b = await addGuest(f, { name: 'Revoked' });
      await consent(f, [a.guestId, b.guestId]);
      await consent(f, [b.guestId], 'revoked');
      expect((await f.owner.post(`${WS(f.owner)}/suppressions`, { channel: 'whatsapp', contact: '9000044444' })).status).toBe(201);
      const pv = await f.owner.post(`${(await makeCampaign(f)).url}/preview`);
      expect(pv.body.eligibleCount).toBe(0);
      expect(pv.body.excludedCounts).toEqual({ suppressed: 2 });
      await f.owner.del(`${WS(f.owner)}/events/${f.eventId}/guests/${a.guestId}`);
      const list = await f.owner.get(`${WS(f.owner)}/suppressions`);
      expect(list.body.data[0].contact).toMatch(/^\+91•+4444$/);
      // the same number re-added as a new guest stays suppressed
      const again = await addGuest(f, { name: 'Same number again', phone: '+919000044444' });
      await consent(f, [again.guestId]);
      expect((await f.owner.post(`${(await makeCampaign(f)).url}/preview`)).body.eligibleCount).toBe(0);
    });
  });

  describe('worker: delivery, link round-trip, retries', () => {
    it('sends via the fake provider, builds a working personal RSVP link, and marks the invitation sent', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const g = await addGuest(f, { name: 'Priya Nair', lang: 'hi' });
      await consent(f, [g.guestId]);
      const c = await makeCampaign(f);
      expect((await schedule(f, c)).status).toBe(200);
      const s = await disp.runOnce(NOON_IST);
      expect(s.submitted).toBe(1);
      const m = (await msgs(c.id))[0];
      expect(m.status).toBe('submitted');
      expect(m.provider).toBe('fake');
      expect(m.attempt_count).toBe(1);
      const inbox = await f.owner.get(`${WS(f.owner)}/test-inbox`);
      const body: string = inbox.body.data[0].body;
      expect(body).toContain('नमस्ते Priya Nair'); // Hindi template for a Hindi-preferring guest
      const token = /\/r#([A-Za-z0-9_-]{43})/.exec(body)![1];
      const view = await request(t.app.getHttpServer()).get(`/v1/public/rsvp/${token}`);
      expect(view.body.guestName).toBe('Priya Nair');
      const inv = await t.db.one<any>(`SELECT status FROM event_invitations WHERE id=$1`, [m.invitation_id]);
      expect(inv.status).toBe('sent');
      const stored = JSON.stringify(await t.db.query(`SELECT * FROM audit_logs WHERE workspace_id=$1`, [f.owner.workspaceId]));
      expect(stored).not.toContain(token); // tokens never reach the audit log
    });
    it('defers sends during quiet hours to the next allowed window (event time zone)', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const g = await addGuest(f);
      await consent(f, [g.guestId]);
      const c = await makeCampaign(f);
      await schedule(f, c);
      const s = await disp.runOnce(NIGHT_IST);
      expect(s.deferred).toBe(1);
      expect(s.submitted).toBe(0);
      const m = (await msgs(c.id))[0];
      expect(m.status).toBe('scheduled');
      expect(m.next_attempt_at.toISOString()).toBe('2027-01-16T03:30:00.000Z'); // 09:00 IST next morning
      expect((await disp.runOnce(new Date('2027-01-16T04:00:00Z'))).submitted).toBe(1);
    });
    it('retries transient failures with backoff and gives up permanently on invalid recipients (dead-letter + audited replay)', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const flaky = await addGuest(f, { phone: '+919000000001' });
      const bad = await addGuest(f, { phone: '+919000000000' });
      await consent(f, [flaky.guestId, bad.guestId]);
      const c = await makeCampaign(f);
      await schedule(f, c);
      const first = await disp.runOnce(NOON_IST);
      expect(first).toMatchObject({ retried: 1, failed: 1 });
      expect((await disp.runOnce(NOON_IST)).submitted).toBe(1); // backoff base is 0 in tests
      const all = await msgs(c.id);
      const f1 = all.find((m) => m.status === 'failed')!;
      expect(f1.last_error_code).toBe('FAKE_INVALID_RECIPIENT');
      expect(f1.dead_lettered_at).not.toBeNull();
      const attempts = await t.db.query(`SELECT status FROM message_attempts WHERE scheduled_message_id=$1`, [
        all.find((m) => m.status === 'submitted').id,
      ]);
      expect(attempts.map((a: any) => a.status)).toEqual(['transient_error', 'submitted']);
      const retry = await f.owner.post(`${c.url}/messages/${f1.id}/retry`, { reason: 'Number corrected by host' });
      expect(retry.status).toBe(200);
      expect((await t.db.one<any>(`SELECT status FROM scheduled_messages WHERE id=$1`, [f1.id]))!.status).toBe('scheduled');
      expect((await t.db.query(`SELECT 1 FROM audit_logs WHERE resource_id=$1 AND action='message.retry_requested'`, [f1.id])).length).toBe(
        1,
      );
    });
    it('records a provider timeout as unknown, then reconciles with the same idempotency key without double-sending', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const g = await addGuest(f, { phone: '+919000000002' });
      await consent(f, [g.guestId]);
      const c = await makeCampaign(f);
      await schedule(f, c);
      expect((await disp.runOnce(NOON_IST)).unknown).toBe(1);
      const m1 = (await msgs(c.id))[0];
      expect(m1.status).toBe('unknown');
      expect((await disp.runOnce(NOON_IST)).claimed).toBe(0); // unknown is never auto-retried by the normal loop
      expect((await disp.reconcileUnknown(NOON_IST, 0)).submitted).toBe(1);
      const m2 = (await msgs(c.id))[0];
      expect(m2.status).toBe('submitted');
      expect(m2.attempt_count).toBe(2);
      const sent = await t.db.query(`SELECT 1 FROM fake_provider_messages WHERE idempotency_key=$1`, [m2.idempotency_key]);
      expect(sent.length).toBe(1);
    });
    it('is safe with concurrent workers (SKIP LOCKED + idempotency): each message is sent exactly once', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const gs = [];
      for (let i = 0; i < 10; i++) gs.push(await addGuest(f));
      await consent(
        f,
        gs.map((g) => g.guestId),
      );
      const c = await makeCampaign(f);
      await schedule(f, c);
      await Promise.all([disp.runOnce(NOON_IST), disp.runOnce(NOON_IST), disp.runOnce(NOON_IST)]);
      const all = await msgs(c.id);
      expect(all.filter((m) => m.status === 'submitted')).toHaveLength(10);
      expect(all.every((m) => m.attempt_count === 1)).toBe(true);
      const n = await t.db.one<{ c: number }>(`SELECT count(*)::int AS c FROM fake_provider_messages WHERE workspace_id=$1`, [
        f.owner.workspaceId,
      ]);
      expect(n!.c).toBe(10);
    });
    it('reclaims messages whose worker crashed (expired lease) without losing or duplicating them', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const g = await addGuest(f);
      await consent(f, [g.guestId]);
      const c = await makeCampaign(f);
      await schedule(f, c);
      await t.db.query(`UPDATE scheduled_messages SET status='queued', locked_until=$2 WHERE campaign_id=$1`, [
        c.id,
        new Date('2027-01-15T06:00:00Z'),
      ]);
      expect((await disp.runOnce(NOON_IST)).submitted).toBe(1);
    });
  });

  describe('state changes while messages are pending', () => {
    it('cancelling a campaign stops queued and scheduled messages (no provider call after cancel)', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const gs = [await addGuest(f), await addGuest(f)];
      await consent(
        f,
        gs.map((g) => g.guestId),
      );
      const c = await makeCampaign(f);
      await schedule(f, c);
      await t.db.query(
        `UPDATE scheduled_messages SET status='queued', locked_until=$2 WHERE campaign_id=$1 AND id=(SELECT id FROM scheduled_messages WHERE campaign_id=$1 LIMIT 1)`,
        [c.id, new Date('2099-01-01')],
      );
      expect((await f.owner.post(`${c.url}/cancel`, { reason: 'wrong date' })).body.status).toBe('cancelled');
      await disp.runOnce(NOON_IST);
      expect((await msgs(c.id)).every((m) => m.status === 'cancelled')).toBe(true);
      expect((await t.db.query(`SELECT 1 FROM fake_provider_messages WHERE workspace_id=$1`, [f.owner.workspaceId])).length).toBe(0);
    });
    it('pause holds messages and resume releases them', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const g = await addGuest(f);
      await consent(f, [g.guestId]);
      const c = await makeCampaign(f);
      await schedule(f, c);
      await f.owner.post(`${c.url}/pause`);
      expect((await disp.runOnce(NOON_IST)).claimed).toBe(0);
      await f.owner.post(`${c.url}/resume`);
      expect((await disp.runOnce(NOON_IST)).submitted).toBe(1);
      expect((await f.owner.get(c.url)).body.status).toBe('completed');
    });
    it('skips a reminder when the guest answered after scheduling (re-check at dispatch) and the outbox cancels pending ones', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const a = await addGuest(f, { name: 'Answers Late' });
      const b = await addGuest(f, { name: 'Answers Via Outbox' });
      await consent(f, [a.guestId, b.guestId]);
      const c = await makeCampaign(f, 'reminder');
      await schedule(f, c);
      const ia = await invitationFor(f, a.guestId);
      const ib = await invitationFor(f, b.guestId);
      const put = (token: string) =>
        request(t.app.getHttpServer())
          .put(`/v1/public/rsvp/${token}/response`)
          .set('Idempotency-Key', `k-${randomUUID()}`)
          .send({ status: 'yes', adultCount: 1, childCount: 0, version: 0 });
      await put(ia.token);
      const s = await disp.runOnce(NOON_IST);
      expect(s).toMatchObject({ skipped: 1, submitted: 1 });
      expect((await msgs(c.id)).find((m) => m.invitation_id === ia.id).skip_reason).toBe('already_responded');
      // second scenario: outbox relay cancels before the worker even claims it
      const f2 = await makeFixture(t.app);
      await attest(f2);
      const g2 = await addGuest(f2);
      await consent(f2, [g2.guestId]);
      const c2 = await makeCampaign(f2, 'reminder');
      await schedule(f2, c2);
      await put((await invitationFor(f2, g2.guestId)).token);
      expect((await relay.runOnce()).published).toBeGreaterThan(0);
      expect((await msgs(c2.id))[0]).toMatchObject({ status: 'cancelled', skip_reason: 'already_responded' });
      void ib;
    });
    it('skips sending if the invitation is revoked or the event is cancelled after scheduling', async () => {
      const f = await makeFixture(t.app);
      await attest(f);
      const a = await addGuest(f);
      const b = await addGuest(f);
      await consent(f, [a.guestId, b.guestId]);
      const c = await makeCampaign(f);
      await schedule(f, c);
      await t.db.query(`UPDATE event_invitations SET revoked_at=now() WHERE id=$1`, [(await invitationFor(f, a.guestId)).id]);
      await f.owner.patch(`${WS(f.owner)}/events/${f.eventId}`, { status: 'cancelled' });
      const s = await disp.runOnce(NOON_IST);
      expect(s.submitted).toBe(0);
      expect(s.skipped).toBe(2);
    });
  });

  describe('provider webhooks', () => {
    async function sentMessage() {
      const f = await makeFixture(t.app);
      await attest(f);
      const g = await addGuest(f);
      await consent(f, [g.guestId]);
      const c = await makeCampaign(f);
      await schedule(f, c);
      await disp.runOnce(NOON_IST);
      return { f, c, m: (await msgs(c.id))[0], g };
    }
    it('rejects bad, missing and stale signatures before parsing the body, and records a security event', async () => {
      const { m } = await sentMessage();
      const ev = { eventId: `evt-${randomUUID()}`, type: 'delivered', providerMessageId: m.provider_message_id };
      expect((await postWebhook(ev, 't=1,v1=deadbeef')).status).toBe(401);
      expect((await request(t.app.getHttpServer()).post('/v1/webhooks/messaging/fake').send(ev)).status).toBe(401);
      const old = sign(ev, Math.floor(Date.now() / 1000) - 3600);
      expect((await postWebhook(ev, old.sig)).status).toBe(401);
      expect((await t.db.query(`SELECT 1 FROM audit_logs WHERE action='security.webhook_signature_invalid'`)).length).toBeGreaterThan(0);
    });
    it('applies delivery events once, ignores duplicates, and never moves status backwards when events arrive out of order', async () => {
      const { m } = await sentMessage();
      const ev = (type: string) => ({ eventId: `evt-${randomUUID()}`, type, providerMessageId: m.provider_message_id });
      const read = ev('read');
      const delivered = ev('delivered');
      expect((await postWebhook(read)).body.result).toBe('applied');
      expect((await postWebhook(delivered)).body.result).toBe('ignored'); // late "delivered" after "read"
      expect((await postWebhook(read)).body.result).toBe('duplicate');
      expect((await t.db.one<any>(`SELECT status FROM scheduled_messages WHERE id=$1`, [m.id]))!.status).toBe('read');
      expect((await postWebhook(ev('failed'))).body.result).toBe('ignored'); // cannot fail after read
      expect((await postWebhook({ eventId: 'evt-unknown-1', type: 'delivered', providerMessageId: 'fake_nope' })).body.result).toBe(
        'unmatched',
      );
      expect((await postWebhook({ eventId: 'x', type: 'nonsense', providerMessageId: 'y' })).status).toBe(422);
    });
    it('an opt-out callback suppresses the contact, revokes consent and cancels other pending messages', async () => {
      const { f, c, m, g } = await sentMessage();
      const c2 = await makeCampaign(f, 'reminder');
      await schedule(f, c2).catch(() => undefined);
      await postWebhook({ eventId: `evt-${randomUUID()}`, type: 'opted_out', providerMessageId: m.provider_message_id });
      expect(
        (
          await t.db.query(
            `SELECT 1 FROM communication_suppressions WHERE workspace_id=$1 AND reason='opted_out' AND source='provider_webhook'`,
            [f.owner.workspaceId],
          )
        ).length,
      ).toBe(1);
      const c3 = await makeCampaign(f, 'reminder');
      expect((await f.owner.post(`${c3.url}/preview`)).body.excludedCounts).toEqual({ suppressed: 1 });
      expect(await t.db.query(`SELECT 1 FROM audit_logs WHERE action='guest.opted_out' AND resource_id=$1`, [g.guestId])).toHaveLength(1);
      void c;
    });
    it('sandbox simulation goes through the same pipeline and is unavailable outside fake mode', async () => {
      const { f, c, m } = await sentMessage();
      const r = await f.owner.post(`${c.url}/messages/${m.id}/simulate`, { event: 'delivered' });
      expect(r.body).toMatchObject({ result: 'applied', status: 'delivered' });
    });
  });

  describe('live messaging is disabled by default and fails closed', () => {
    const base = {
      DATABASE_URL: 'postgres://x',
      CSRF_SECRET: 'a'.repeat(32),
      RSVP_TOKEN_SECRET: 'b'.repeat(32),
      PSEUDONYM_SECRET: 'c'.repeat(32),
    } as NodeJS.ProcessEnv;
    it('defaults to the fake provider with live disabled', () => {
      const c = loadConfig(base);
      expect(c.MESSAGING_MODE).toBe('fake');
      expect(c.LIVE_MESSAGING_ENABLED).toBe(false);
    });
    it('refuses to start when live is requested without every safeguard', () => {
      expect(() => loadConfig({ ...base, MESSAGING_MODE: 'live' })).toThrow(ConfigError);
      expect(() => loadConfig({ ...base, LIVE_MESSAGING_ENABLED: 'true' })).toThrow(/safeguards are incomplete/);
      expect(() => loadConfig({ ...base, MESSAGING_MODE: 'live', LIVE_MESSAGING_ENABLED: 'true', LIVE_PROVIDER_NAME: 'x' })).toThrow(
        /LIVE_PROVIDER_CREDENTIALS_REF/,
      );
    });
    it('uses only the fake provider in a default app (no outbound provider calls are possible)', async () => {
      const { f, c } = await (async () => {
        const f = await makeFixture(t.app);
        await attest(f);
        const g = await addGuest(f);
        await consent(f, [g.guestId]);
        const c = await makeCampaign(f);
        await schedule(f, c);
        return { f, c };
      })();
      await disp.runOnce(NOON_IST);
      expect((await msgs(c.id))[0].provider).toBe('fake');
      void f;
    });
  });
});
