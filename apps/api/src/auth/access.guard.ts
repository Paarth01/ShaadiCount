import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DbService } from '../common/db.service';
import { ApiError, forbidden, notFound, unauthorized } from '../common/errors';
import { AppRequest, PERM_KEY, PUBLIC_KEY, UUID_RE } from '../common/request';
import { CONFIG, Config } from '../config/config';
import { AuditService } from '../audit/audit.service';
import { SESSION_COOKIE, SessionService } from './session.service';
import { Permission, Role, can } from './permissions';
import { safeEqual } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Single global guard, in order:
 *  1. public routes pass;
 *  2. session cookie -> authenticated user (401 otherwise);
 *  3. CSRF token + Origin check on state-changing requests;
 *  4. :workspaceId routes -> server-side membership lookup (non-members get a generic 404 and a security log);
 *  5. @Perm() role check (403 + security log).
 * The workspace id from the URL is never trusted by itself: it is only used to look up the caller's membership.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimitService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();

    const token = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) throw unauthorized();
    req.ctx.user = session.user;
    req.ctx.sessionId = session.sessionId;
    // Per-user ceiling for every authenticated request: bounds abuse by a single (possibly compromised) account.
    this.limiter.hit(`user:${session.user.id}`, this.cfg.RATE_LIMIT_USER_PER_MIN);

    if (MUTATING.has(req.method)) {
      const origin = req.header('origin');
      if (origin && !this.cfg.webOrigins.includes(origin)) throw new ApiError(403, 'CSRF_ORIGIN_DENIED', 'Request origin is not allowed');
      const sent = req.header('x-csrf-token');
      if (!sent || !safeEqual(sent, this.sessions.csrfFor(session.sessionId))) {
        throw new ApiError(403, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token');
      }
    }

    const wsId = req.params?.workspaceId as string | undefined;
    if (wsId !== undefined) {
      if (!UUID_RE.test(wsId)) throw notFound('Workspace');
      const m = await this.db.one<{ role: Role; name: string }>(
        `SELECT m.role, w.name FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.workspace_id = $1 AND m.user_id = $2 AND w.deleted_at IS NULL`,
        [wsId.toLowerCase(), session.user.id],
      );
      if (!m) {
        // Same response whether the workspace exists or not: no existence oracle.
        // Throttled per user so probing random workspace ids cannot flood the audit log.
        const k = `deny-audit:${session.user.id}`;
        if (this.limiter.count(k) < 20) {
          this.limiter.hit(k, 20);
          await this.audit.security(req.ctx, 'workspace_access_denied', { method: req.method, route: req.route?.path }, null);
        }
        throw notFound('Workspace');
      }
      req.ctx.workspace = { id: wsId.toLowerCase(), role: m.role, name: m.name };
    }

    const needed = this.reflector.getAllAndOverride<Permission[] | undefined>(PERM_KEY, [context.getHandler(), context.getClass()]);
    if (needed?.length) {
      if (!req.ctx.workspace) throw forbidden();
      const role = req.ctx.workspace.role;
      if (!needed.every((p) => can(role, p))) {
        const k = `deny-audit:${session.user.id}`;
        if (this.limiter.count(k) < 20) {
          this.limiter.hit(k, 20);
          await this.audit.security(
            req.ctx,
            'permission_denied',
            { role, needed, method: req.method, route: req.route?.path },
            req.ctx.workspace.id,
          );
        }
        throw forbidden();
      }
    }
    return true;
  }
}
