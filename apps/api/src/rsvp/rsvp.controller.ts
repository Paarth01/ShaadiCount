import { Body, Controller, Get, Headers, Param, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Ctx, Public, RequestCtx } from '../common/request';
import { zb } from '../common/zod.pipe';
import { RsvpService, rsvpSchema } from './rsvp.service';

/** Guest-facing endpoints: no session, authorised solely by the unguessable per-invitation token. */
@Controller('v1/public/rsvp/:token')
export class PublicRsvpController {
  constructor(private readonly svc: RsvpService) {}

  private noIndex(res: Response) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  @Public()
  @Get()
  view(@Ctx() ctx: RequestCtx, @Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    this.noIndex(res);
    return this.svc.view(ctx, token);
  }

  @Public()
  @Put('response')
  async submit(
    @Ctx() ctx: RequestCtx,
    @Param('token') token: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(zb(rsvpSchema)) body: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noIndex(res);
    const r = await this.svc.submit(ctx, token, key, body);
    res.status(r.status);
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }
}
