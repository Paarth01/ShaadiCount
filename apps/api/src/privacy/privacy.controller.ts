import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Ctx, Perm, RequestCtx } from '../common/request';
import { uuidParam, zb } from '../common/zod.pipe';
import { PrivacyService, dataRequestSchema } from './privacy.service';

@Controller('v1/workspaces/:workspaceId/data-requests')
export class PrivacyController {
  constructor(private readonly svc: PrivacyService) {}
  @Get() @Perm('privacy:manage') list(@Ctx() ctx: RequestCtx) {
    return this.svc.list(ctx);
  }
  @Post() @Perm('privacy:manage') @HttpCode(201) create(@Ctx() ctx: RequestCtx, @Body(zb(dataRequestSchema)) b: any) {
    return this.svc.create(ctx, b);
  }
  @Post(':requestId/cancel') @Perm('privacy:manage') @HttpCode(200) cancel(
    @Ctx() ctx: RequestCtx,
    @Param('requestId', uuidParam) id: string,
  ) {
    return this.svc.cancel(ctx, id);
  }
}
