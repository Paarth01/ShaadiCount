/** Normalises a phone number to E.164. Indian 10-digit mobiles default to +91. Returns null when invalid. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s().-]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
  if (/^0?[6-9]\d{9}$/.test(s)) return '+91' + s.replace(/^0/, '');
  if (/^91[6-9]\d{9}$/.test(s)) return '+' + s;
  return null;
}

export function maskPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  return p.slice(0, 3) + '•'.repeat(Math.max(p.length - 7, 3)) + p.slice(-4);
}

export function maskEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}•••@${d ?? ''}`;
}

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
