import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, newKey, setCsrf } from '@/lib/api';
import { STRINGS, t } from '@/lib/i18n';
import { fmtDateTime, fmtRupees, initials, plural } from '@/lib/format';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('api client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setCsrf('');
  });
  it('sends the CSRF token and idempotency key on mutations only', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ok: true }));
    setCsrf('tok-123');
    await api.get('/v1/x');
    await api.post('/v1/y', { a: 1 }, { idempotencyKey: 'k-1234567890123456' });
    const get = f.mock.calls[0][1]!.headers as Record<string, string>;
    const post = f.mock.calls[1][1]!.headers as Record<string, string>;
    expect(get['X-CSRF-Token']).toBeUndefined();
    expect(post['X-CSRF-Token']).toBe('tok-123');
    expect(post['Idempotency-Key']).toBe('k-1234567890123456');
    expect(post['Content-Type']).toBe('application/json');
    expect(f.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
  });
  it('maps API errors, including field details and extra payload (e.g. current RSVP on conflict)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(409, {
        error: {
          code: 'VERSION_CONFLICT',
          message: 'changed',
          requestId: 'r1',
          details: [{ field: 'version', message: 'stale' }],
          current: { version: 3 },
        },
      }),
    );
    const e = (await api.put('/v1/z', {}).catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: 'VERSION_CONFLICT', requestId: 'r1', extra: { current: { version: 3 } } });
    expect(e.fieldError('version')).toBe('stale');
  });
  it('turns network failures into a friendly status-0 error and handles 204', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('failed'));
    expect(await api.get('/v1/x').catch((x) => x)).toMatchObject({ status: 0, code: 'NETWORK' });
    f.mockResolvedValueOnce(json(204, null));
    expect(await api.post('/v1/logout')).toBeUndefined();
  });
  it('generates distinct idempotency keys of valid length', () => {
    const a = newKey(),
      b = newKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });
});

describe('i18n', () => {
  it('has exactly the same keys in English and Hindi, with no empty strings', () => {
    expect(Object.keys(STRINGS.hi).sort()).toEqual(Object.keys(STRINGS.en).sort());
    for (const l of ['en', 'hi'] as const) for (const [k, v] of Object.entries(STRINGS[l])) expect(v.trim(), `${l}.${k}`).not.toBe('');
  });
  it('keeps the same placeholders in both languages and interpolates them', () => {
    for (const k of Object.keys(STRINGS.en))
      expect((STRINGS.hi[k].match(/\{\w+\}/g) ?? []).sort(), k).toEqual((STRINGS.en[k].match(/\{\w+\}/g) ?? []).sort());
    expect(t('en', 'maxPeople', { n: 4 })).toBe('Maximum 4');
    expect(t('hi', 'maxPeople', { n: 4 })).toBe('अधिकतम 4');
    expect(t('en', 'nope')).toBe('nope');
  });
});

describe('format helpers', () => {
  it('formats times in the event zone, rupees and plurals', () => {
    expect(fmtDateTime('2027-02-10T11:30:00.000Z', 'Asia/Kolkata')).toMatch(/10 Feb 2027.*5:00\s?pm/i);
    expect(fmtDateTime('2027-02-10T11:30:00.000Z', 'America/New_York')).toMatch(/6:30\s?am/i);
    expect(fmtRupees(123456)).toContain('1,234.56');
    expect(fmtRupees(null)).toBe('-');
    expect(plural(1, 'guest')).toBe('1 guest');
    expect(plural(2, 'person', 'people')).toBe('2 people');
    expect(initials('Asha Rao Iyer')).toBe('AR');
  });
});
