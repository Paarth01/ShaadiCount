import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req as NReq, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Ctx, Perm, Public, Req, RequestCtx, AppRequest } from '../common/request';
import { uuidParam, zb } from '../common/zod.pipe';
import { CampaignsService, createCampaignSchema, messagesQuery, reasonBody, scheduleSchema, simulateSchema } from './campaigns.service';
import { WebhooksService } from './webhooks.service';

const FN = 'v1/workspaces/:workspaceId/events/:eventId/functions/:functionId';

@Controller()
export class MessagingController {
  constructor(private readonly svc: CampaignsService) {}

  @Get(`${FN}/campaigns`)
  @Perm('campaigns:read')
  list(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Param('functionId', uuidParam) f: string) {
    return this.svc.list(ctx, e, f);
  }
  @Post(`${FN}/campaigns`)
  @Perm('campaigns:write')
  @HttpCode(201)
  create(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Body(zb(createCampaignSchema)) b: any,
  ) {
    return this.svc.create(ctx, e, f, b);
  }
  @Get(`${FN}/campaigns/:campaignId`)
  @Perm('campaigns:read')
  get(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('campaignId', uuidParam) c: string,
  ) {
    return this.svc.get(ctx, e, f, c);
  }
  @Post(`${FN}/campaigns/:campaignId/preview`)
  @Perm('campaigns:read')
  @HttpCode(200)
  preview(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('campaignId', uuidParam) c: string,
  ) {
    return this.svc.preview(ctx, e, f, c);
  }

  @Post(`${FN}/campaigns/:campaignId/schedule`)
  @Perm('campaigns:send')
  async schedule(
    @Ctx() ctx: RequestCtx,
    @Res({ passthrough: true }) res: Response,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('campaignId', uuidParam) c: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(zb(scheduleSchema)) b: any,
  ) {
    const r = await this.svc.schedule(ctx, e, f, c, key, b);
    res.status(r.status);
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }
  @Post(`${FN}/campaigns/:campaignId/pause`)
  @Perm('campaigns:send')
  @HttpCode(200)
  pause(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('campaignId', uuidParam) c: string,
  ) {
    return this.svc.pause(ctx, e, f, c);
  }
  @Post(`${FN}/campaigns/:campaignId/resume`)
  @Perm('campaigns:send')
  @HttpCode(200)
  resume(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('campaignId', uuidParam) c: string,
  ) {
    return this.svc.resume(ctx, e, f, c);
  }
  @Post(`${FN}/campaigns/:campaignId/cancel`)
  @Perm('campaigns:send')
  @HttpCode(200)
  cancel(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('campaignId', uuidParam) c: string,
    @Body(zb(reasonBody.partial())) b: any,
  ) {
    return this.svc.cancel(ctx, e, f, c, b.reason);
  }

  @Get(`${FN}/campaigns/:campaignId/messages`)
  @Perm('campaigns:read')
  messages(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('campaignId', uuidParam) c: string,
    @Query(zb(messagesQuery)) q: any,
  ) {
    return this.svc.messages(ctx, e, f, c, q);
  }
  @Post(`${FN}/campaigns/:campaignId/messages/:messageId/retry`)
  @Perm('campaigns:send')
  @HttpCode(200)
  retry(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('campaignId', uuidParam) c: string,
    @Param('messageId', uuidParam) m: string,
    @Body(zb(reasonBody)) b: any,
  ) {
    return this.svc.retry(ctx, e, f, c, m, b.reason);
  }
  @Post(`${FN}/campaigns/:campaignId/messages/:messageId/simulate`)
  @Perm('messages:simulate')
  @HttpCode(200)
  simulate(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('campaignId', uuidParam) c: string,
    @Param('messageId', uuidParam) m: string,
    @Body(zb(simulateSchema)) b: any,
  ) {
    return this.svc.simulate(ctx, e, f, c, m, b.event);
  }

  @Get('v1/workspaces/:workspaceId/test-inbox')
  @Perm('messages:simulate')
  inbox(@Ctx() ctx: RequestCtx) {
    return this.svc.testInbox(ctx);
  }
}

/** Provider callbacks: unauthenticated by session, authenticated by HMAC signature over the raw body. */
@Controller('v1/webhooks/messaging')
export class WebhookController {
  constructor(private readonly svc: WebhooksService) {}
  @Public()
  @Post(':provider')
  @HttpCode(200)
  receive(
    @Ctx() ctx: RequestCtx,
    @Req() req: AppRequest,
    @Param('provider') provider: string,
    @Headers('x-shaadicount-signature') sig?: string,
  ) {
    return this.svc.ingest(ctx, provider, req.rawBody, sig);
  }
}
export const _n = NReq;
