import { DateTime } from 'luxon';

export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  return DateTime.local().setZone(tz).isValid;
}

/**
 * Accepts either an RFC 3339 instant with an offset/Z, or an event-local wall-clock time ("2026-12-10T18:30")
 * which is interpreted in the event's IANA zone (DST-aware). Returns a UTC Date or null if invalid.
 */
export function parseEventTime(input: string, tz: string): Date | null {
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(input);
  const dt = hasOffset ? DateTime.fromISO(input, { setZone: true }) : DateTime.fromISO(input, { zone: tz });
  return dt.isValid ? dt.toUTC().toJSDate() : null;
}

export function toEventLocal(d: Date | null, tz: string): string | null {
  return d ? DateTime.fromJSDate(d, { zone: tz }).toFormat("yyyy-LL-dd'T'HH:mm") : null;
}

/** Next instant at/after `from` that is outside quiet hours [start,end) in the event zone (hours 0-23). */
export function nextAllowedSendTime(from: Date, tz: string, quietStart: number, quietEnd: number): Date {
  if (quietStart === quietEnd) return from;
  const local = DateTime.fromJSDate(from, { zone: tz });
  const h = local.hour;
  const inQuiet = quietStart < quietEnd ? h >= quietStart && h < quietEnd : h >= quietStart || h < quietEnd;
  if (!inQuiet) return from;
  let open = local.set({ hour: quietEnd, minute: 0, second: 0, millisecond: 0 });
  if (open <= local) open = open.plus({ days: 1 });
  return open.toUTC().toJSDate();
}

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
