import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Ctx, Perm, RequestCtx } from '../common/request';
import { uuidParam, zb } from '../common/zod.pipe';
import { ReportingService, cateringSettingsSchema, exportSchema, nonRespondersSchema, snapshotSchema } from './reporting.service';

const EV = 'v1/workspaces/:workspaceId/events/:eventId';

@Controller()
export class ReportingController {
  constructor(private readonly svc: ReportingService) {}

  @Get(`${EV}/dashboard`)
  @Perm('dashboard:read')
  eventDashboard(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string) {
    return this.svc.eventDashboard(ctx, e);
  }
  @Get(`${EV}/functions/:functionId/dashboard`)
  @Perm('dashboard:read')
  fnDashboard(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Param('functionId', uuidParam) f: string) {
    return this.svc.functionDashboard(ctx, e, f);
  }
  @Get(`${EV}/functions/:functionId/non-responders`)
  @Perm('nonresponders:read')
  nonResponders(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Query(zb(nonRespondersSchema)) q: any,
  ) {
    return this.svc.nonResponders(ctx, e, f, q);
  }

  @Get(`${EV}/functions/:functionId/catering`)
  @Perm('catering:read')
  catering(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Param('functionId', uuidParam) f: string) {
    return this.svc.catering(ctx, e, f);
  }
  @Put(`${EV}/functions/:functionId/catering/settings`)
  @Perm('catering:write')
  settings(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Body(zb(cateringSettingsSchema)) b: any,
  ) {
    return this.svc.updateCateringSettings(ctx, e, f, b);
  }
  @Post(`${EV}/functions/:functionId/catering/snapshots`)
  @Perm('catering:write')
  @HttpCode(201)
  snapshot(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Body(zb(snapshotSchema)) b: any,
  ) {
    return this.svc.saveSnapshot(ctx, e, f, b.label);
  }
  @Get(`${EV}/functions/:functionId/catering/snapshots`)
  @Perm('catering:read')
  snapshots(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Param('functionId', uuidParam) f: string) {
    return this.svc.snapshots(ctx, e, f);
  }

  // Per-kind permission is enforced in the service (a caterer may export the catering report only).
  @Post(`${EV}/exports`)
  @Perm('workspace:read')
  @HttpCode(201)
  createExport(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Body(zb(exportSchema)) b: any) {
    return this.svc.createExport(ctx, e, b);
  }
  @Get('v1/workspaces/:workspaceId/exports/:exportId/download')
  @Perm('workspace:read')
  async download(@Ctx() ctx: RequestCtx, @Param('exportId', uuidParam) id: string, @Res() res: Response) {
    const d = await this.svc.download(ctx, id);
    res.setHeader('Content-Type', d.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${d.filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(d.content);
  }
}
