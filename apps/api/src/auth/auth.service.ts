import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, isUniqueViolation } from '../common/db.service';
import { ApiError, unauthorized } from '../common/errors';
import { dummyHash, hashPassword, verifyPassword } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import { CONFIG, Config } from '../config/config';
import { SessionService } from './session.service';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { isValidEmail } from '../common/phone';
import { weakPasswordReason } from './password-policy';
import type { RequestCtx } from '../common/request';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).refine(isValidEmail, 'Enter a valid email address'),
  password: z.string().min(10, 'Use at least 10 characters').max(128),
  displayName: z.string().trim().min(1).max(120),
  workspaceName: z.string().trim().min(1).max(160).optional(),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(128),
});

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimitService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private checkPassword(pw: string, email: string) {
    const reason = weakPasswordReason(pw, email);
    if (reason) {
      throw new ApiError(422, 'WEAK_PASSWORD', 'Choose a stronger password', [{ field: 'password', message: reason }]);
    }
  }

  async register(ctx: RequestCtx, input: z.infer<typeof registerSchema>, ua?: string) {
    this.limiter.hit(`register:${ctx.ip}`, this.cfg.RATE_LIMIT_REGISTER_PER_MIN);
    this.checkPassword(input.password, input.email);
    const hash = await hashPassword(input.password);
    let userId: string;
    let workspaceId: string | null = null;
    try {
      await this.db.tx(async (q) => {
        const u = await q.one<{ id: string }>(`INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id`, [
          input.email,
          hash,
          input.displayName,
        ]);
        userId = u!.id;
        if (input.workspaceName) {
          const w = await q.one<{ id: string }>(`INSERT INTO workspaces (name, created_by) VALUES ($1,$2) RETURNING id`, [
            input.workspaceName,
            userId,
          ]);
          workspaceId = w!.id;
          await q.query(`INSERT INTO workspace_members (workspace_id, user_id, role, created_by) VALUES ($1,$2,'owner',$2)`, [
            workspaceId,
            userId,
          ]);
          await this.audit.log(
            q,
            { requestId: ctx.requestId, user: undefined },
            { workspaceId, actorUserId: userId, action: 'workspace.created', resourceType: 'workspace', resourceId: workspaceId },
          );
          await this.analytics.track(q, 'workspace_created', { workspaceId });
        }
      });
    } catch (e) {
      if (isUniqueViolation(e, 'users_email')) throw new ApiError(409, 'EMAIL_IN_USE', 'An account with this email already exists');
      throw e;
    }
    const s = await this.sessions.create(userId!, ua);
    return { user: { id: userId!, email: input.email, displayName: input.displayName }, workspaceId, ...s };
  }

  async login(ctx: RequestCtx, input: z.infer<typeof loginSchema>, ua?: string) {
    this.limiter.hit(`login:ip:${ctx.ip}`, this.cfg.RATE_LIMIT_LOGIN_PER_MIN);
    // Per email AND client: a third party hammering someone's email from their own address can no longer lock that
    // person out (they use a different bucket). A much higher email-only ceiling still caps distributed guessing.
    this.limiter.hit(`login:email-ip:${input.email}:${ctx.ip}`, this.cfg.RATE_LIMIT_LOGIN_PER_MIN);
    this.limiter.hit(`login:email:${input.email}`, this.cfg.RATE_LIMIT_LOGIN_EMAIL_PER_MIN);
    const u = await this.db.one<{ id: string; email: string; display_name: string; password_hash: string; disabled_at: Date | null }>(
      `SELECT id, email, display_name, password_hash, disabled_at FROM users WHERE lower(email) = $1`,
      [input.email],
    );
    // Always run one scrypt verification so response time doesn't reveal whether the email exists.
    const ok = await verifyPassword(input.password, u?.password_hash ?? (await dummyHash()));
    if (!u || !ok || u.disabled_at) {
      await this.audit.security(ctx, 'login_failed', { reason: 'invalid_credentials' });
      throw unauthorized('Incorrect email or password');
    }
    const s = await this.sessions.create(u.id, ua); // new session id on every login (rotation)
    await this.audit.log(
      null,
      { requestId: ctx.requestId, user: undefined },
      { actorUserId: u.id, action: 'auth.login', resourceType: 'user', resourceId: u.id },
    );
    return { user: { id: u.id, email: u.email, displayName: u.display_name }, ...s };
  }

  async logout(ctx: RequestCtx) {
    if (ctx.sessionId) await this.sessions.revoke(ctx.sessionId);
    await this.audit.log(null, ctx, { action: 'auth.logout', resourceType: 'user', resourceId: ctx.user?.id });
  }
}
