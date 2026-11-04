import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Inject } from '@nestjs/common';
import { Ctx, Public, Req, RequestCtx, AppRequest } from '../common/request';
import { zb } from '../common/zod.pipe';
import { AuthService, loginSchema, registerSchema } from './auth.service';
import { SESSION_COOKIE, SessionService } from './session.service';
import { CONFIG, Config } from '../config/config';
import { DbService } from '../common/db.service';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly db: DbService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private setCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cfg.isProd,
      path: '/',
      maxAge: this.cfg.SESSION_TTL_HOURS * 3_600_000,
    });
  }

  @Public()
  @Post('register')
  async register(
    @Ctx() ctx: RequestCtx,
    @Req() req: AppRequest,
    @Body(zb(registerSchema)) body: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.register(ctx, body, req.header('user-agent'));
    this.setCookie(res, r.token);
    res.status(201);
    return { user: r.user, workspaceId: r.workspaceId, csrfToken: r.csrf };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Ctx() ctx: RequestCtx, @Req() req: AppRequest, @Body(zb(loginSchema)) body: any, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(ctx, body, req.header('user-agent'));
    this.setCookie(res, r.token);
    return { user: r.user, csrfToken: r.csrf };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Ctx() ctx: RequestCtx, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  async me(@Ctx() ctx: RequestCtx) {
    const workspaces = await this.db.query(
      `SELECT w.id, w.name, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = $1 AND w.deleted_at IS NULL ORDER BY w.created_at`,
      [ctx.user!.id],
    );
    return { user: ctx.user, csrfToken: this.sessions.csrfFor(ctx.sessionId!), workspaces };
  }
}
