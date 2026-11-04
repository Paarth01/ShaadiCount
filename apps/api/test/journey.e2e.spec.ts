import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { Client, createTestApp, idem, TestCtx } from './helpers';
import { DispatcherService } from '../src/messaging/dispatcher.service';
import { OutboxRelayService } from '../src/messaging/outbox-relay.service';

/**
 * One continuous wedding-organizer journey through the real HTTP API, real PostgreSQL, the real worker and the
 * fake messaging provider. Steps share state and run in order (this is an end-to-end scenario, not independent unit cases).
 */
describe('E2E journey: from CSV import to check-in', () => {
  let t: TestCtx;
  let o: Client;
  let disp: DispatcherService;
  let relay: OutboxRelayService;
  let ws = '';
  let eventId = '';
  const fn: Record<string, string> = {};
  const NOON = new Date('2027-01-15T06:30:00Z'); // 12:00 IST
  const base = () => `/v1/workspaces/${ws}/events/${eventId}`;
  const F = (n: string) => `${base()}/functions/${fn[n]}`;
  const guestReq = (token: string) => request(t.app.getHttpServer()).get(`/v1/public/rsvp/${token}`);
  const guestPut = (token: string, body: object) =>
    request(t.app.getHttpServer()).put(`/v1/public/rsvp/${token}/response`).set('Idempotency-Key', `k-${randomUUID()}`).send(body);
  const tokenFromInbox = async (name: string) => {
    const inbox = await o.get(`/v1/workspaces/${ws}/test-inbox`);
    const m = inbox.body.data.find((x: any) => x.body?.includes(name));
    expect(m).toBeTruthy();
    return /\/r#([A-Za-z0-9_-]{43})/.exec(m.body)![1];
  };

  beforeAll(async () => {
    t = await createTestApp();
    disp = t.app.get(DispatcherService);
    relay = t.app.get(OutboxRelayService);
    await t.db.query(
      `UPDATE scheduled_messages SET status='cancelled', skip_reason='test_cleanup' WHERE status IN ('scheduled','queued','unknown')`,
    );
  });
  afterAll(async () => {
    await t.close();
  });

  it('1. organizer signs up, creates an event and its functions with deadlines', async () => {
    o = await Client.register(t.app, { name: 'Meera Planner', workspaceName: 'Meera Weddings' });
    ws = o.workspaceId;
    const ev = await o.post(`/v1/workspaces/${ws}/events`, {
      name: 'Aarav & Diya',
      timezone: 'Asia/Kolkata',
      startDate: '2027-02-10',
      endDate: '2027-02-11',
    });
    eventId = ev.body.id;
    for (const [name, startsAt, dl] of [
      ['Mehendi', '2027-02-10T16:00', '2027-02-03T18:00'],
      ['Wedding', '2027-02-11T10:00', '2027-02-04T18:00'],
    ]) {
      const r = await o.post(`${base()}/functions`, { name, startsAt, rsvpDeadline: dl, venue: 'Palace Gardens', capacity: 50 });
      expect(r.status).toBe(201);
      fn[name] = r.body.id;
    }
  });

  it('2. imports a CSV: errors and a duplicate are caught, valid rows become guests with invitations', async () => {
    const csv = [
      'name,mobile,language,family,functions,party size',
      'Anita Rao,98200 11115,hindi,Rao family,Mehendi;Wedding,3',
      'Dev Mehta,98200 11125,english,Mehta family,Mehendi;Wedding,2',
      'Sana Khan,98200 11135,english,Khan family,Wedding,4',
      'Broken Row,12,english,,Wedding,1',
      'Anita Rao,98200 11115,hindi,Rao family,Wedding,1',
    ].join('\n');
    const pv = await o.post(`${base()}/imports/preview`, { csv, filename: 'guests.csv' });
    expect(pv.body.summary).toEqual({ totalRows: 5, valid: 3, duplicates: 1, errors: 1 });
    const done = await o.post(`${base()}/imports/${pv.body.importId}/commit`, {}, idem());
    expect(done.body).toMatchObject({ created: 3, invitationsCreated: 5, messagingAuthorized: false });
  });

  it('3. nothing can be sent yet: no consent evidence and no attestation', async () => {
    const c = await o.post(`${F('Mehendi')}/campaigns`, { name: 'Mehendi invites', kind: 'invitation', channel: 'whatsapp' });
    const pv = await o.post(`${F('Mehendi')}/campaigns/${c.body.id}/preview`);
    expect(pv.body).toMatchObject({ eligibleCount: 0, excludedCounts: { no_consent_evidence: 2 }, attestationRequired: true });
  });

  it('4. organizer attests authority and records permission evidence, then schedules after confirming cost', async () => {
    expect((await o.post(`/v1/workspaces/${ws}/contact-authority-attestation`, { confirm: true })).status).toBe(200);
    const guests = await o.get(`${base()}/guests`);
    const ids = guests.body.data.map((g: any) => g.id);
    expect(
      (
        await o.post(`${base()}/consents`, {
          guestIds: ids,
          channel: 'whatsapp',
          basis: 'organizer_attestation',
          evidenceNote: 'Guests shared numbers with the host for wedding updates',
        })
      ).status,
    ).toBe(201);
    const list = await o.get(`${F('Mehendi')}/campaigns`);
    const c = list.body.data[0];
    const pv = await o.post(`${F('Mehendi')}/campaigns/${c.id}/preview`);
    expect(pv.body.eligibleCount).toBe(2);
    expect(pv.body.sample.map((s: any) => s.language).sort()).toEqual(['en', 'hi']);
    const sch = await o.post(
      `${F('Mehendi')}/campaigns/${c.id}/schedule`,
      { confirmRecipientCount: 2, confirmEstimatedCostPaise: pv.body.estimatedCostPaise },
      idem(),
    );
    expect(sch.status).toBe(200);
  });

  it('5. the worker sends via the fake provider and each guest gets a personal, localized link', async () => {
    const s = await disp.runOnce(NOON);
    expect(s.submitted).toBe(2);
    const inbox = await o.get(`/v1/workspaces/${ws}/test-inbox`);
    expect(inbox.body.data).toHaveLength(2);
    expect(inbox.body.data.some((m: any) => m.body.includes('नमस्ते Anita Rao'))).toBe(true);
    expect(inbox.body.data.every((m: any) => m.to.includes('•'))).toBe(true);
  });

  it('6. guests open their links and answer: Anita says Yes (3), Dev says Maybe', async () => {
    const anita = await tokenFromInbox('Anita Rao');
    const view = await guestReq(anita);
    expect(view.body).toMatchObject({ guestName: 'Anita Rao', language: 'hi', partySizeMax: 3, state: 'open' });
    const a = await guestPut(anita, { status: 'yes', adultCount: 2, childCount: 1, version: 0 });
    expect(a.status).toBe(201);
    expect(a.body.checkinCode).toMatch(/^[A-Z2-9]{12}$/);
    const d = await guestPut(await tokenFromInbox('Dev Mehta'), { status: 'maybe', adultCount: 1, childCount: 0, version: 0 });
    expect(d.body.response.status).toBe('maybe');
  });

  it('7. the dashboard and non-responder list reflect reality; Sana (Wedding only) is still pending', async () => {
    const d = await o.get(`${F('Mehendi')}/dashboard`);
    expect(d.body.counts).toMatchObject({ invitations: 2, yes: 1, maybe: 1, no: 0, notResponded: 0 });
    expect(d.body.people).toMatchObject({ confirmedAdults: 2, confirmedChildren: 1, tentativeTotal: 1 });
    const w = await o.get(`${F('Wedding')}/dashboard`);
    expect(w.body.counts).toMatchObject({ invitations: 3, responded: 0, notResponded: 3 });
    const nr = await o.get(`${F('Wedding')}/non-responders`);
    expect(nr.body.total).toBe(3);
    expect(JSON.stringify(nr.body)).not.toMatch(/98200/);
  });

  it('8. a reminder for the Wedding goes only to people who have not answered, and respects a late answer', async () => {
    const c = await o.post(`${F('Wedding')}/campaigns`, { name: 'Wedding reminder', kind: 'reminder', channel: 'whatsapp' });
    const url = `${F('Wedding')}/campaigns/${c.body.id}`;
    const pv = await o.post(`${url}/preview`);
    expect(pv.body.eligibleCount).toBe(3);
    await o.post(`${url}/schedule`, { confirmRecipientCount: 3, confirmEstimatedCostPaise: pv.body.estimatedCostPaise }, idem());
    // Sana answers on her own just before the worker runs.
    const sana = (await o.get(`${F('Wedding')}/invitations?search=sana`)).body.data[0];
    const link = (await o.get(`${F('Wedding')}/invitations/${sana.id}/link`)).body.link as string;
    await guestPut(link.split('#')[1], { status: 'no', adultCount: 0, childCount: 0, version: 0 });
    await relay.runOnce();
    const s = await disp.runOnce(NOON);
    expect(s.submitted).toBe(2); // Anita + Dev; Sana's reminder was cancelled
    const stats = (await o.get(url)).body;
    expect(stats.status).toBe('completed');
    expect(stats.stats).toMatchObject({ submitted: 2, cancelled: 1 });
    expect(stats.skipReasons).toEqual({ already_responded: 1 });
  });

  it('9. catering recalculates from live RSVPs with transparent assumptions', async () => {
    await o.put(`${F('Mehendi')}/catering/settings`, {
      maybeWeightPercent: 50,
      bufferPercent: 10,
      mealRounding: 5,
      adultPricePaise: 60000,
      childPricePaise: 30000,
    });
    const c = await o.get(`${F('Mehendi')}/catering`);
    // adults 2 + 0.5 = 2.5 x1.1 -> 3 ; children 1 x1.1 -> 2 ; total 5
    expect(c.body.estimate).toMatchObject({ adultMeals: 3, childMeals: 2, estimatedMeals: 5, estimatedCostPaise: 3 * 60000 + 2 * 30000 });
    expect(c.body.disclaimer).toMatch(/not an attendance guarantee/);
  });

  it('10. on the day, gate staff check Anita in by QR; a second scan is a harmless duplicate', async () => {
    const anita = (await o.get(`${F('Mehendi')}/invitations?search=anita`)).body.data[0];
    const token = ((await o.get(`${F('Mehendi')}/invitations/${anita.id}/link`)).body.link as string).split('#')[1];
    const code = (await guestReq(token)).body.checkinCode;
    const first = await o.post(`${F('Mehendi')}/checkin`, { code });
    expect(first.body.checkIn).toMatchObject({ adults: 2, children: 1, method: 'qr' });
    expect((await o.post(`${F('Mehendi')}/checkin`, { code })).body.duplicate).toBe(true);
    const rec = await o.get(`${F('Mehendi')}/checkin/reconciliation`);
    expect(rec.body).toMatchObject({ partial: true, rsvpYesPeople: 3, checkedInPeople: 3, yesNotYetArrived: 0 });
  });

  it('11. a guest replies STOP: the contact is suppressed and excluded from every future campaign', async () => {
    const msg = await t.db.one<any>(
      `SELECT m.provider_message_id FROM scheduled_messages m JOIN event_invitations i ON i.id=m.invitation_id JOIN guests g ON g.id=i.guest_id WHERE g.workspace_id=$1 AND g.display_name='Dev Mehta' AND m.status='submitted' LIMIT 1`,
      [ws],
    );
    const ev = { eventId: `evt-${randomUUID()}`, type: 'opted_out', providerMessageId: msg.provider_message_id };
    const raw = JSON.stringify(ev);
    const ts = Math.floor(Date.now() / 1000);
    const sig = `t=${ts},v1=${createHmac('sha256', process.env.MESSAGING_WEBHOOK_SECRET!).update(`${ts}.${raw}`).digest('hex')}`;
    const r = await request(t.app.getHttpServer())
      .post('/v1/webhooks/messaging/fake')
      .set('Content-Type', 'application/json')
      .set('X-Shaadicount-Signature', sig)
      .send(raw);
    expect(r.body.result).toBe('opted_out');
    const sup = await o.get(`/v1/workspaces/${ws}/suppressions`);
    expect(sup.body.data).toHaveLength(1);
    expect(sup.body.data[0].contact).toMatch(/\u2022/);
    const c = await o.post(`${F('Mehendi')}/campaigns`, {
      name: 'Follow-up',
      kind: 'invitation',
      channel: 'whatsapp',
      audience: 'all_invited',
    });
    const pv = await o.post(`${F('Mehendi')}/campaigns/${c.body.id}/preview`);
    expect(pv.body.excludedCounts.suppressed).toBe(1);
  });

  it('12. exports are escaped, scoped and audited, and the audit trail tells the whole story without personal data', async () => {
    const e = await o.post(`${base()}/exports`, { kind: 'rsvps', functionId: fn.Mehendi });
    const csv = (await o.get(e.body.downloadPath)).text;
    expect(csv.split('\r\n')[0]).toBe('guest,group,invited_party_size,rsvp_status,adults,children,responded_at,last_updated_by');
    expect(csv).not.toMatch(/98200/);
    const actions = (await o.get(`/v1/workspaces/${ws}/audit-logs?limit=200`)).body.data.map((a: any) => a.action);
    for (const a of [
      'workspace.created',
      'event.created',
      'guest_import.committed',
      'consent.granted',
      'workspace.contact_authority_attested',
      'campaign.scheduled',
      'rsvp.submitted',
      'checkin.recorded',
      'export.created',
    ])
      expect(actions).toContain(a);
    expect(JSON.stringify(actions)).not.toMatch(/98200/);
  });
});
