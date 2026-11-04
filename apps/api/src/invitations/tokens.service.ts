import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { CONFIG, Config } from '../config/config';
import { hmacB64Url, sha256Hex } from '../common/crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I for manual entry

/**
 * RSVP links and check-in codes are derived: token = HMAC(RSVP_TOKEN_SECRET, id, version).
 * Only SHA-256(token) is stored, so a database leak cannot reveal usable links, while the server can still
 * rebuild the same link for reminders. Rotation bumps the version; revocation sets revoked_at.
 */
@Injectable()
export class TokensService {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  rsvpToken(invitationId: string, version: number): string {
    return hmacB64Url(this.cfg.RSVP_TOKEN_SECRET, `rsvp:${invitationId}:${version}`); // 43 chars, 256-bit
  }
  checkinCode(invitationId: string, version: number): string {
    const d = createHmac('sha256', this.cfg.RSVP_TOKEN_SECRET).update(`checkin:${invitationId}:${version}`).digest();
    let out = '';
    for (let i = 0; i < 12; i++) out += ALPHABET[d[i] % 32];
    return out; // 60 bits
  }
  hash(v: string): string {
    return sha256Hex(v);
  }
  hashes(invitationId: string, version: number) {
    return { tokenHash: this.hash(this.rsvpToken(invitationId, version)), checkinHash: this.hash(this.checkinCode(invitationId, version)) };
  }
  link(invitationId: string, version: number): string {
    // Fragment form: the token never reaches web-server logs, link-preview crawlers or Referer headers.
    return `${this.cfg.PUBLIC_APP_URL.replace(/\/$/, '')}/r#${this.rsvpToken(invitationId, version)}`;
  }
  isWellFormed(token: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(token);
  }
}
