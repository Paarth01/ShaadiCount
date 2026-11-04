import { normalizePhone, maskPhone, maskEmail } from './phone';
import { csvCell, toCsv } from './csv';
import { isValidTimezone, nextAllowedSendTime, parseEventTime, toEventLocal } from './time';
import { redact, redactString, AppLogger } from './logger';
import { hashPassword, verifyPassword } from './crypto';

describe('phone', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+1 (415) 555-0132', '+14155550132'],
    ['0044 20 7946 0958', '+442079460958'],
  ])('normalises %s', (i, o) => expect(normalizePhone(i)).toBe(o));
  it.each(['12345', 'abc', '+0123456789', '5876543210', '', '+9198765'])('rejects %s', (i) => expect(normalizePhone(i)).toBeNull());
  it('masks for display', () => {
    expect(maskPhone('+919876543210')).toBe('+91••••••3210');
    expect(maskEmail('anita@example.com')).toBe('a•••@example.com');
  });
});

describe('csv export safety', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tTAB', '\rCR'])('neutralises formula starter %j', (v) =>
    expect(csvCell(v).replace(/^"/, '')).toMatch(/^'/),
  );
  it('quotes commas, quotes and newlines and leaves normal text alone', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('Asha')).toBe('Asha');
    expect(csvCell(null)).toBe('');
  });
  it('builds CRLF rows', () => expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\r\n1,x\r\n'));
});

describe('time zones', () => {
  it('validates IANA names', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('Nope/Zone')).toBe(false);
  });
  it('interprets wall-clock input in the event zone and honours explicit offsets', () => {
    expect(parseEventTime('2027-02-10T17:00', 'Asia/Kolkata')!.toISOString()).toBe('2027-02-10T11:30:00.000Z');
    expect(parseEventTime('2027-02-10T17:00:00+00:00', 'Asia/Kolkata')!.toISOString()).toBe('2027-02-10T17:00:00.000Z');
    expect(parseEventTime('garbage', 'Asia/Kolkata')).toBeNull();
    expect(toEventLocal(new Date('2027-02-10T11:30:00Z'), 'Asia/Kolkata')).toBe('2027-02-10T17:00');
  });
  it('moves sends out of quiet hours (21:00-09:00 local), including across midnight', () => {
    const tz = 'Asia/Kolkata';
    expect(nextAllowedSendTime(new Date('2027-01-15T06:30:00Z'), tz, 21, 9).toISOString()).toBe('2027-01-15T06:30:00.000Z'); // 12:00 ok
    expect(nextAllowedSendTime(new Date('2027-01-15T17:30:00Z'), tz, 21, 9).toISOString()).toBe('2027-01-16T03:30:00.000Z'); // 23:00 -> 09:00 next day
    expect(nextAllowedSendTime(new Date('2027-01-15T22:00:00Z'), tz, 21, 9).toISOString()).toBe('2027-01-16T03:30:00.000Z'); // 03:30 -> 09:00 same day
    expect(nextAllowedSendTime(new Date('2027-01-15T17:30:00Z'), tz, 0, 0).toISOString()).toBe('2027-01-15T17:30:00.000Z'); // disabled
  });
});

describe('logging redaction', () => {
  it('removes RSVP tokens from URLs and phone numbers from text', () => {
    expect(redactString('GET /v1/public/rsvp/abcDEF123_-xyz/response 200')).toBe('GET /v1/public/rsvp/[redacted]/response 200');
    expect(redactString('call +91 98765 43210 now')).not.toMatch(/98765/);
    expect(redactString('request 8825c5af-026d-435f-bdf2-f376a897dc72')).toContain('8825c5af-026d-435f-bdf2-f376a897dc72');
  });
  it('redacts sensitive keys recursively and never throws on odd values', () => {
    const o = redact({ user: { email: 'a@b.c', phone: '1', token: 't', name: 'ok' }, list: [{ password: 'x' }], requestId: 'r-1' }) as any;
    expect(o.user).toEqual({ email: '[redacted]', phone: '[redacted]', token: '[redacted]', name: 'ok' });
    expect(o.list[0].password).toBe('[redacted]');
    expect(o.requestId).toBe('r-1');
  });
  it('writes one JSON line per entry and honours the level', () => {
    const lines: string[] = [];
    const l = new AppLogger('warn', (s) => lines.push(s));
    l.info('hidden');
    l.warn('shown', { authorization: 'Bearer x' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'warn', msg: 'shown', authorization: '[redacted]' });
  });
});

describe('password hashing', () => {
  it('verifies the right password only, with unique salts', async () => {
    const a = await hashPassword('Correct-Horse-Battery-9');
    const b = await hashPassword('Correct-Horse-Battery-9');
    expect(a).not.toBe(b);
    expect(await verifyPassword('Correct-Horse-Battery-9', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
  });
});

describe('TIME-01: DST-aware scheduling semantics', () => {
  it('maps the same local wall-clock time to different UTC instants across the US spring-forward change', () => {
    expect(parseEventTime('2027-03-13T09:00', 'America/New_York')!.toISOString()).toBe('2027-03-13T14:00:00.000Z');
    expect(parseEventTime('2027-03-15T09:00', 'America/New_York')!.toISOString()).toBe('2027-03-15T13:00:00.000Z');
  });
  it('moves a nonexistent local time (02:30 on spring-forward day) forward rather than failing', () => {
    expect(parseEventTime('2027-03-14T02:30', 'America/New_York')).not.toBeNull();
  });
  it('keeps quiet-hours boundaries in event-local time across a DST change', () => {
    // 23:00 EDT on 2027-03-15 -> next window opens 09:00 EDT = 13:00Z
    expect(nextAllowedSendTime(new Date('2027-03-16T03:00:00Z'), 'America/New_York', 21, 9).toISOString()).toBe('2027-03-16T13:00:00.000Z');
  });
});
