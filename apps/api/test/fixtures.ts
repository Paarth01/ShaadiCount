import { INestApplication } from '@nestjs/common';
import { Client } from './helpers';

export const WS = (c: Client) => `/v1/workspaces/${c.workspaceId}`;

export interface Fixture {
  owner: Client;
  eventId: string;
  fn: Record<string, string>;
  base: (name?: string) => string;
}

/** Owner + workspace + an event in Asia/Kolkata with Mehendi and Wedding functions (future dates, open RSVP). */
export async function makeFixture(app: INestApplication, extraFns: Record<string, Record<string, unknown>> = {}): Promise<Fixture> {
  const owner = await Client.register(app, { workspaceName: 'Fixture Weddings' });
  const ev = await owner.post(`${WS(owner)}/events`, {
    name: 'Aarav & Diya',
    timezone: 'Asia/Kolkata',
    startDate: '2027-02-10',
    endDate: '2027-02-12',
    hostName: 'Sharma family',
  });
  if (ev.status !== 201) throw new Error('event: ' + JSON.stringify(ev.body));
  const eventId = ev.body.id as string;
  const fn: Record<string, string> = {};
  const defs: Record<string, Record<string, unknown>> = {
    Mehendi: { startsAt: '2027-02-10T17:00', rsvpDeadline: '2027-02-05T18:00', venue: 'Garden Lawn', capacity: 100 },
    Wedding: { startsAt: '2027-02-12T19:00', rsvpDeadline: '2027-02-06T18:00', venue: 'Palace Hall', capacity: 300 },
    ...extraFns,
  };
  for (const [name, d] of Object.entries(defs)) {
    const r = await owner.post(`${WS(owner)}/events/${eventId}/functions`, { name, ...d });
    if (r.status !== 201) throw new Error(`function ${name}: ` + JSON.stringify(r.body));
    fn[name] = r.body.id;
  }
  return { owner, eventId, fn, base: (name = 'Mehendi') => `${WS(owner)}/events/${eventId}/functions/${fn[name]}` };
}

let n = 0;
/** Creates a guest and (optionally) invites them to functions; returns ids. Phones use a reserved fake range. */
export async function addGuest(
  f: Fixture,
  o: { name?: string; phone?: string | null; email?: string; lang?: 'en' | 'hi'; invite?: Record<string, number> } = {},
) {
  n += 1;
  // Last digit is always 5, so default numbers never collide with the fake provider's magic suffixes (0000/0001/0002).
  const phone = o.phone === undefined ? `+91900${String(2000000 + n * 10 + 5)}` : o.phone;
  const r = await f.owner.post(`${WS(f.owner)}/events/${f.eventId}/guests`, {
    displayName: o.name ?? `Guest ${n}`,
    phone,
    email: o.email,
    preferredLanguage: o.lang ?? 'en',
    invitations: Object.entries(o.invite ?? { Mehendi: 2 }).map(([name, partySize]) => ({ functionId: f.fn[name], partySize })),
  });
  if (r.status !== 201) throw new Error('guest: ' + JSON.stringify(r.body));
  const list = await f.owner.get(`${f.base()}/invitations?limit=200`);
  return { guestId: r.body.id as string, phone, list: list.body };
}

export async function invitationFor(f: Fixture, guestId: string, fnName = 'Mehendi') {
  const list = await f.owner.get(`${f.base(fnName)}/invitations?limit=200`);
  const inv = list.body.data.find((i: any) => i.guestId === guestId);
  if (!inv) throw new Error('invitation not found');
  const link = await f.owner.get(`${f.base(fnName)}/invitations/${inv.id}/link`);
  const token = (link.body.link as string).split('#')[1];
  return { id: inv.id as string, token, link: link.body.link as string };
}
