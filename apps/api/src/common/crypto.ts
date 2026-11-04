import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');
export const hmacB64Url = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const scrypt = (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (e, k) => (e ? reject(e) : resolve(k))));

const P = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Password hashing with Node's built-in scrypt (memory-hard, per-user salt). Format: scrypt$N$r$p$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, P);
  return `scrypt$${P.N}$${P.r}$${P.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'), 64, { N: +n, r: +r, p: +p, maxmem: P.maxmem });
  return timingSafeEqual(key, Buffer.from(hash, 'base64'));
}

/** A valid hash of a random password, used to keep login timing similar for unknown emails. */
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword(randomToken(16)));
