/**
 * Password quality rules (length is enforced by the Zod schema). Deliberately dependency-free: it rejects the passwords
 * attackers try first, without pretending to be a full strength estimator. For breached-password screening use a
 * k-anonymity service (e.g. HIBP Pwned Passwords) in front of this.
 */
const COMMON = [
  'password',
  'passw0rd',
  'qwerty',
  'letmein',
  'welcome',
  'iloveyou',
  'admin',
  'shaadicount',
  'wedding',
  'abc123',
  'monkey',
  'dragon',
  'football',
  'cricket',
  'india123',
];
const SEQUENCES = ['01234567890123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm'];

const isRepeatedUnit = (s: string) => {
  for (let n = 1; n <= Math.min(4, s.length / 2); n++) {
    if (s.length % n === 0 && s.slice(0, n).repeat(s.length / n) === s) return true;
  }
  return false;
};
const isMostlySequence = (s: string) => {
  const rev = [...s].reverse().join('');
  return SEQUENCES.some((q) => q.includes(s) || q.includes(rev));
};

export function weakPasswordReason(pw: string, email: string): string | null {
  const lower = pw.toLowerCase();
  const local = email.split('@')[0].toLowerCase();
  if (new Set(lower).size < 6) return 'Use more different characters';
  if (isRepeatedUnit(lower)) return 'Avoid repeated patterns';
  if (isMostlySequence(lower)) return 'Avoid keyboard or number sequences';
  if (COMMON.some((c) => lower.includes(c))) return 'Avoid common words and passwords';
  if (local.length >= 4 && lower.includes(local)) return 'Do not include your email name';
  return null;
}
