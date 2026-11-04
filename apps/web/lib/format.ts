const en = 'en-IN';
export function fmtDateTime(iso: string | null | undefined, tz: string, lang: 'en' | 'hi' = 'en'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : en, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
export function fmtDate(iso: string | null | undefined, tz = 'Asia/Kolkata'): string {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(en, { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : tz, dateStyle: 'medium' }).format(d);
}
export const fmtRupees = (paise: number | null | undefined) =>
  paise === null || paise === undefined
    ? '-'
    : new Intl.NumberFormat(en, { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
/** Human wording for stable API error codes/reasons. */
export const REASONS: Record<string, string> = {
  no_consent_evidence: 'No permission recorded',
  no_contact: 'No contact details',
  suppressed: 'Opted out / suppressed',
  already_responded: 'Already responded',
  not_in_audience: 'Not in audience',
  already_messaged: 'Already messaged',
  deadline_passed: 'RSVP deadline passed',
  invitation_revoked: 'Invitation revoked',
  channel_disabled: 'Channel disabled',
  event_inactive: 'Event inactive',
  function_inactive: 'Function inactive',
  invalid_contact: 'Invalid contact',
  campaign_cancelled: 'Campaign cancelled',
  opted_out: 'Opted out',
  guest_deleted: 'Guest deleted',
  workspace_not_attested: 'Attestation missing',
};
