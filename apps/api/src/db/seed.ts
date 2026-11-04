import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { loadEnvFile } from './env-file';
import { migrate } from './migrate';
import { DbService } from '../common/db.service';
import { hashPassword, randomToken } from '../common/crypto';
import { EventsService } from '../events/events.service';
import { GuestsService } from '../guests/guests.service';
import { TokensService } from '../invitations/tokens.service';
import { RsvpService } from '../rsvp/rsvp.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CampaignsService } from '../messaging/campaigns.service';
import type { RequestCtx } from '../common/request';
import type { Role } from '../auth/permissions';
import { DateTime } from 'luxon';

/** Local development seed: 100% synthetic data, no real people, no real phone numbers. Refuses to run in production. */
const FIRST = [
  'Aarav',
  'Diya',
  'Kabir',
  'Meera',
  'Rohan',
  'Anika',
  'Vihaan',
  'Ishita',
  'Arjun',
  'Saanvi',
  'Neel',
  'Tara',
  'Dev',
  'Anaya',
  'Yash',
  'Riya',
  'Krish',
  'Myra',
  'Aditya',
  'Nisha',
];
const LAST = ['Sharma', 'Verma', 'Iyer', 'Nair', 'Gupta', 'Rao', 'Mehta', 'Kulkarni', 'Singh', 'Das'];
const GROUPS = ["Groom's family", "Bride's family", 'College friends', 'Colleagues', 'Neighbours'];

async function main() {
  loadEnvFile();
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await migrate(process.env.DATABASE_URL);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const db = app.get(DbService);
  const tokens = app.get(TokensService);
  const events = app.get(EventsService);
  const guests = app.get(GuestsService);
  const rsvp = app.get(RsvpService);
  const workspaces = app.get(WorkspacesService);
  const campaigns = app.get(CampaignsService);

  const existing = await db.one(`SELECT id FROM workspaces WHERE name='Demo: Sharma-Verma Weddings' AND deleted_at IS NULL`);
  if (existing) {
    console.log('Demo workspace already exists; nothing to do. Run `npm run db:reset` first for a clean slate.');
    await app.close();
    return;
  }

  const creds: { role: string; email: string; password: string }[] = [];
  const mkUser = async (email: string, name: string, role: string) => {
    const password = randomToken(12); // generated now, printed once, never stored in plaintext
    const u = await db.one<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
      [email, await hashPassword(password), name],
    );
    if (!u) {
      console.log(`User ${email} already exists; keeping its password`);
      return (await db.one<{ id: string }>(`SELECT id FROM users WHERE lower(email)=$1`, [email]))!.id;
    }
    creds.push({ role, email, password });
    return u.id;
  };
  const ownerId = await mkUser('demo.owner@example.test', 'Demo Owner', 'owner');
  const ctx = (userId: string, wsId: string, role: Role): RequestCtx => ({
    requestId: `seed-${randomUUID()}`,
    ip: '127.0.0.1',
    user: { id: userId, email: '', displayName: '' },
    workspace: { id: wsId, role, name: 'Demo: Sharma-Verma Weddings' },
  });

  const ws = await workspaces.create(
    { requestId: 'seed', ip: '127.0.0.1', user: { id: ownerId, email: '', displayName: '' } },
    'Demo: Sharma-Verma Weddings',
  );
  const oc = ctx(ownerId, ws.id, 'owner');
  await workspaces.attestContactAuthority(oc);

  const staff: [string, string, Role][] = [
    ['demo.organizer@example.test', 'Demo Organizer', 'organizer'],
    ['demo.planner@example.test', 'Demo Planner', 'planner'],
    ['demo.gate@example.test', 'Demo Gate Staff', 'checkin_staff'],
    ['demo.caterer@example.test', 'Demo Caterer', 'caterer'],
  ];
  const staffIds: Record<string, string> = {};
  for (const [email, name, role] of staff) {
    staffIds[role] = await mkUser(email, name, role);
    await workspaces.addMember(oc, { email, role });
  }

  const base = DateTime.now().setZone('Asia/Kolkata').plus({ days: 45 }).startOf('day');
  const ev = await events.create(oc, {
    name: 'Aarav & Diya Wedding',
    timezone: 'Asia/Kolkata',
    startDate: base.toISODate()!,
    endDate: base.plus({ days: 2 }).toISODate()!,
    hostName: 'Sharma & Verma families',
  });
  const defs = [
    { name: 'Mehendi', day: 0, hour: 16, venue: 'Garden Lawn', capacity: 80 },
    { name: 'Sangeet', day: 1, hour: 19, venue: 'Banquet Hall A', capacity: 120 },
    { name: 'Wedding Ceremony', day: 2, hour: 10, venue: 'Mandap Grounds', capacity: 200 },
    { name: 'Reception', day: 2, hour: 20, venue: 'Grand Ballroom', capacity: 220, allowChildren: true },
  ];
  const fns: Record<string, any> = {};
  for (const d of defs) {
    const start = base.plus({ days: d.day, hours: d.hour });
    fns[d.name] = await events.createFunction(oc, ev.id, {
      name: d.name,
      startsAt: start.toFormat("yyyy-LL-dd'T'HH:mm"),
      rsvpDeadline: start.minus({ days: 10 }).toFormat("yyyy-LL-dd'T'HH:mm"),
      venue: d.venue,
      capacity: d.capacity,
      allowResponseEdits: true,
      allowChildren: d.allowChildren ?? true,
      status: 'active',
    });
  }
  const fnNames = Object.keys(fns);

  await workspaces.setAssignments(oc, staffIds.planner, { eventIds: [ev.id], functionIds: [] });
  await workspaces.setAssignments(oc, staffIds.caterer, { eventIds: [ev.id], functionIds: [] });
  await workspaces.setAssignments(oc, staffIds.checkin_staff, {
    eventIds: [],
    functionIds: [fns['Wedding Ceremony'].id, fns['Reception'].id],
  });

  let seedN = 7;
  const rnd = () => (seedN = (seedN * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const guestIds: string[] = [];
  for (let i = 0; i < 40; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / 4) % LAST.length]}`;
    const chosen = fnNames.filter((_, k) => k === 2 || rnd() > 0.35);
    const g = await guests.create(oc, ev.id, {
      displayName: name,
      phone: `+91900${String(3000000 + i * 10 + 5)}`,
      preferredLanguage: i % 5 === 0 ? 'hi' : 'en',
      groupLabel: GROUPS[i % GROUPS.length],
      tags: [],
      allowDuplicate: true,
      invitations: chosen.map((n) => ({ functionId: fns[n].id, partySize: 1 + Math.floor(rnd() * 4) })),
    });
    guestIds.push(g.id);
  }
  await guests.recordConsent(oc, ev.id, {
    guestIds: guestIds.slice(0, 28),
    channel: 'whatsapp',
    status: 'granted',
    basis: 'organizer_attestation',
    evidenceNote: 'Synthetic demo data: consent evidence recorded by seed script',
  });

  // Answer ~60% of invitations through the real guest flow (tokens derived exactly as production does).
  const invs = await db.query<any>(`SELECT i.id, i.token_version, i.invited_party_size FROM event_invitations i WHERE i.workspace_id=$1`, [
    ws.id,
  ]);
  let answered = 0;
  for (const inv of invs) {
    if (rnd() > 0.6) continue;
    const roll = rnd();
    const status = roll < 0.65 ? 'yes' : roll < 0.8 ? 'maybe' : 'no';
    const adults = status === 'no' ? 0 : Math.max(1, Math.ceil(inv.invited_party_size * 0.7));
    const children = status === 'no' ? 0 : Math.min(inv.invited_party_size - adults, rnd() > 0.7 ? 1 : 0);
    try {
      await rsvp.submit(
        { requestId: 'seed', ip: `10.0.${answered % 250}.1` },
        tokens.rsvpToken(inv.id, inv.token_version),
        `seed-${randomUUID()}`,
        { status, adultCount: adults, childCount: children, version: 0 },
      );
      answered++;
    } catch {
      /* party-size edge cases are skipped */
    }
  }
  await campaigns.create(oc, ev.id, fns['Sangeet'].id, { name: 'Sangeet RSVP reminder', kind: 'reminder', channel: 'whatsapp' });

  console.log('\nDemo data created (synthetic; no real contacts). Messaging runs on the FAKE provider only.');
  console.log(
    `  workspace: ${ws.id}\n  event:     ${ev.id}\n  guests:    ${guestIds.length}, invitations: ${invs.length}, answered: ${answered}\n`,
  );
  if (creds.length) {
    console.log('Generated one-time passwords (shown once, not stored in plaintext):');
    for (const c of creds) console.log(`  ${c.role.padEnd(14)} ${c.email.padEnd(32)} ${c.password}`);
  }
  await app.close();
}
main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
