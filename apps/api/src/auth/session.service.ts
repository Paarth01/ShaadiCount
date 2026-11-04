import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { CONFIG, Config } from '../config/config';
import { hmacB64Url, randomToken, sha256Hex } from '../common/crypto';

export interface SessionInfo {
  sessionId: string;
  user: { id: string; email: string; displayName: string };
}

@Injectable()
export class SessionService {
  constructor(
    private readonly db: DbService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  csrfFor(sessionId: string) {
    return hmacB64Url(this.cfg.CSRF_SECRET, sessionId);
  }

  /** Creates a new session (rotation: callers always create a fresh one at login). Returns the opaque cookie value. */
  async create(userId: string, userAgent?: string) {
    const token = randomToken(32);
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent) VALUES ($1,$2, now() + ($3 || ' hours')::interval, $4) RETURNING id`,
      [userId, sha256Hex(token), String(this.cfg.SESSION_TTL_HOURS), userAgent?.slice(0, 200) ?? null],
    );
    return { token, sessionId: row!.id, csrf: this.csrfFor(row!.id) };
  }

  async resolve(token: string): Promise<SessionInfo | null> {
    const row = await this.db.one<{ id: string; uid: string; email: string; display_name: string; last_seen_at: Date }>(
      `SELECT s.id, u.id AS uid, u.email, u.display_name, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.last_seen_at > now() - ($2 || ' hours')::interval AND u.disabled_at IS NULL`,
      [sha256Hex(token), String(this.cfg.SESSION_IDLE_HOURS)],
    );
    if (!row) return null;
    if (Date.now() - row.last_seen_at.getTime() > 60_000) {
      await this.db.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [row.id]);
    }
    return { sessionId: row.id, user: { id: row.uid, email: row.email, displayName: row.display_name } };
  }

  async revoke(sessionId: string) {
    await this.db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
  }
  async revokeAllForUser(userId: string) {
    await this.db.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }
}

export const SESSION_COOKIE = 'sc_session';
