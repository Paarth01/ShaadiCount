import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Ctx, Perm, RequestCtx } from '../common/request';
import { uuidParam, zb } from '../common/zod.pipe';
import { CheckinService, checkInSchema, searchSchema, voidSchema } from './checkin.service';

const FN = 'v1/workspaces/:workspaceId/events/:eventId/functions/:functionId/checkin';

@Controller(FN)
export class CheckinController {
  constructor(private readonly svc: CheckinService) {}

  @Get('search')
  @Perm('guests:lookup')
  search(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Query(zb(searchSchema)) q: any,
  ) {
    return this.svc.search(ctx, e, f, q.q);
  }

  @Post()
  @Perm('checkin:write')
  async checkIn(
    @Ctx() ctx: RequestCtx,
    @Res({ passthrough: true }) res: Response,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(zb(checkInSchema)) b: any,
  ) {
    const r = await this.svc.checkIn(ctx, e, f, key, b);
    res.status(r.status);
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post(':checkInId/void')
  @Perm('checkin:correct')
  @HttpCode(200)
  void(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('checkInId', uuidParam) c: string,
    @Body(zb(voidSchema)) b: any,
  ) {
    return this.svc.void(ctx, e, f, c, b.reason);
  }

  @Get('reconciliation')
  @Perm('workspace:read')
  reconciliation(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Param('functionId', uuidParam) f: string) {
    return this.svc.reconciliation(ctx, e, f);
  }
}
