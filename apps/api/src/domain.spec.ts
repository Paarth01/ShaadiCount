import { nextStatus } from './messaging/webhooks.service';
import { normalizeCounts, stateOf } from './rsvp/rsvp.service';
import { parseGuestCsv, CsvError } from './guests/import';
import { TokensService } from './invitations/tokens.service';
import { renderTemplate, getTemplate, TEMPLATES } from './messaging/templates';
import { ROLES, ROLE_PERMISSIONS, can } from './auth/permissions';
import { loadConfig } from './config/config';

describe('webhook status machine', () => {
  it('only moves delivery states forward', () => {
    expect(nextStatus('submitted', 'delivered')).toBe('delivered');
    expect(nextStatus('delivered', 'read')).toBe('read');
    expect(nextStatus('read', 'delivered')).toBeNull();
    expect(nextStatus('delivered', 'submitted')).toBeNull();
    expect(nextStatus('unknown', 'delivered')).toBe('delivered'); // a callback proves the provider accepted it
    expect(nextStatus('queued', 'submitted')).toBe('submitted');
  });
  it('never overwrites terminal states and cannot fail after delivery', () => {
    for (const s of ['failed', 'cancelled', 'skipped'])
      for (const t of ['submitted', 'delivered', 'read', 'failed'] as const) expect(nextStatus(s, t)).toBeNull();
    expect(nextStatus('delivered', 'failed')).toBeNull();
    expect(nextStatus('submitted', 'failed')).toBe('failed');
    expect(nextStatus('submitted', 'opted_out')).toBeNull();
  });
});

describe('RSVP count rules', () => {
  it('No always zeroes the counts', () => expect(normalizeCounts('no', 3, 2, 4, true)).toEqual({ adults: 0, children: 0 }));
  it('Yes needs at least one person and respects the child policy and party size', () => {
    expect(() => normalizeCounts('yes', 0, 0, 4, true)).toThrow(/how many/);
    expect(() => normalizeCounts('yes', 1, 1, 4, false)).toThrow(/children/);
    expect(() => normalizeCounts('yes', 3, 2, 4, true)).toThrow(/up to 4/);
    expect(normalizeCounts('yes', 3, 1, 4, true)).toEqual({ adults: 3, children: 1 });
  });
  it('Maybe may have zero or provisional counts; organizers can explicitly exceed the cap', () => {
    expect(normalizeCounts('maybe', 0, 0, 2, true)).toEqual({ adults: 0, children: 0 });
    expect(normalizeCounts('yes', 5, 0, 2, true, true)).toEqual({ adults: 5, children: 0 });
  });
  it('derives the page state from status, deadline and edit policy', () => {
    const base = { event_status: 'active', fn_status: 'active', rsvp_deadline: null, r_status: null, allow_response_edits: true };
    const now = new Date('2027-01-01T00:00:00Z');
    expect(stateOf(base, now)).toBe('open');
    expect(stateOf({ ...base, rsvp_deadline: '2026-12-31T00:00:00Z' }, now)).toBe('closed_deadline');
    expect(stateOf({ ...base, r_status: 'yes', allow_response_edits: false }, now)).toBe('locked');
    expect(stateOf({ ...base, fn_status: 'cancelled' }, now)).toBe('closed_cancelled');
    expect(stateOf({ ...base, event_status: 'completed' }, now)).toBe('closed_completed');
  });
});

describe('guest CSV parser', () => {
  const fns = new Map([
    ['mehendi', 'f1'],
    ['wedding', 'f2'],
  ]);
  it('auto-detects common header names, normalises phones and resolves function names', () => {
    const r = parseGuestCsv(
      'Full Name,Mobile Number,Language,Invited To,Pax\nAsha Rao,98765 43210,hindi,Mehendi | Wedding,3',
      undefined,
      fns,
    );
    expect(r.rows[0].data).toMatchObject({
      name: 'Asha Rao',
      phone: '+919876543210',
      language: 'hi',
      functionIds: ['f1', 'f2'],
      partySize: 3,
    });
  });
  it('reports every row-level problem with the row number', () => {
    const r = parseGuestCsv('name,phone,email,party size,functions\n,1,bad,0,Sangeet', undefined, fns);
    expect(r.rows[0].errors.map((e) => e.field).sort()).toEqual(['email', 'functions', 'name', 'partySize', 'phone']);
    expect(r.rows[0].rowNumber).toBe(2);
  });
  it('handles BOM, quoted commas and blank lines; warns when a guest has no contact', () => {
    const r = parseGuestCsv('\uFEFFname,phone\n"Rao, Asha",\n\n"Mehta, Dev",9876543210', undefined, fns);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].data!.name).toBe('Rao, Asha');
    expect(r.rows[0].warnings[0]).toMatch(/No contact/);
  });
  it('rejects empty files, missing name column, unknown mapped columns and oversize input', () => {
    expect(() => parseGuestCsv('name\n', undefined, fns)).toThrow(CsvError);
    expect(() => parseGuestCsv('phone\n123', undefined, fns)).toThrow(/name column/);
    expect(() => parseGuestCsv('a,b\n1,2', { name: 'zzz' }, fns)).toThrow(/not in the file/);
    expect(() => parseGuestCsv('name\n' + 'x'.repeat(1_000_000), undefined, fns)).toThrow(/larger/);
  });
});

describe('invitation tokens', () => {
  const svc = new TokensService({ RSVP_TOKEN_SECRET: 's'.repeat(40), PUBLIC_APP_URL: 'https://app.example.test/' } as any);
  it('derives stable, high-entropy, version-specific tokens and unambiguous check-in codes', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(svc.rsvpToken(id, 1)).toBe(svc.rsvpToken(id, 1));
    expect(svc.rsvpToken(id, 1)).not.toBe(svc.rsvpToken(id, 2));
    expect(svc.rsvpToken(id, 1)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(svc.checkinCode(id, 1)).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(svc.hash(svc.rsvpToken(id, 1))).toMatch(/^[0-9a-f]{64}$/);
  });
  it('uses a URL fragment so tokens stay out of server logs and Referer headers', () => {
    expect(svc.link('11111111-1111-4111-8111-111111111111', 1)).toMatch(/^https:\/\/app\.example\.test\/r#[A-Za-z0-9_-]{43}$/);
  });
});

describe('message templates', () => {
  it('every template has English and Hindi bodies using only declared variables, and an opt-out instruction', () => {
    for (const t of TEMPLATES)
      for (const lang of ['en', 'hi'] as const) {
        const used = [...t.body[lang].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
        expect(used.every((v) => t.variables.includes(v))).toBe(true);
        expect(t.body[lang]).toMatch(/STOP/);
      }
    expect(TEMPLATES.every((t) => t.approvedForLive === false)).toBe(true); // nothing is provider-approved in this repo
  });
  it('refuses to render with missing variables and flattens newlines in guest-provided values', () => {
    const t = getTemplate('reminder_v1')!;
    expect(() => renderTemplate(t, 'en', { guest_name: 'A' })).toThrow(/Missing/);
    const out = renderTemplate(t, 'en', {
      guest_name: 'Line1\nLine2',
      event_name: 'E',
      function_name: 'F',
      rsvp_deadline: 'soon',
      rsvp_link: 'https://x/r#t',
    });
    expect(out).not.toContain('\n');
    expect(out).toContain('Line1 Line2');
  });
});

describe('role matrix invariants', () => {
  it('only owners manage members/privacy; nobody but owner/organizer exports contacts or reads audit', () => {
    for (const r of ROLES) {
      expect(can(r, 'members:manage')).toBe(r === 'owner');
      expect(can(r, 'privacy:manage')).toBe(r === 'owner');
      expect(can(r, 'guests:export')).toBe(r === 'owner' || r === 'organizer');
      expect(can(r, 'audit:read')).toBe(r === 'owner' || r === 'organizer');
    }
  });
  it('least privilege: caterer and readonly cannot read guests; check-in staff cannot message or export', () => {
    for (const p of ['guests:read', 'guests:write', 'campaigns:send', 'nonresponders:read'] as const) {
      expect(can('caterer', p)).toBe(false);
      expect(can('readonly', p)).toBe(false);
    }
    for (const p of ['campaigns:send', 'guests:export', 'catering:read', 'dashboard:read'] as const)
      expect(can('checkin_staff', p)).toBe(false);
    expect(ROLE_PERMISSIONS.readonly.size).toBeLessThan(ROLE_PERMISSIONS.planner.size);
  });
});

describe('configuration', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    CSRF_SECRET: 'a'.repeat(32),
    RSVP_TOKEN_SECRET: 'b'.repeat(32),
    PSEUDONYM_SECRET: 'c'.repeat(32),
  } as NodeJS.ProcessEnv;
  it('requires strong secrets and has no default for them', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x' } as any)).toThrow(/CSRF_SECRET/);
    expect(() => loadConfig({ ...base, CSRF_SECRET: 'short' })).toThrow(/at least 32/);
  });
  it('stores sandbox message bodies only outside production by default', () => {
    expect(loadConfig(base).FAKE_PROVIDER_STORE_BODIES).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).FAKE_PROVIDER_STORE_BODIES).toBe(false);
  });
});
