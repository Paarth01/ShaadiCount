import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Ctx, Perm, RequestCtx } from '../common/request';
import { uuidParam, zb } from '../common/zod.pipe';
import { forbidden } from '../common/errors';
import { can } from '../auth/permissions';
import { z } from 'zod';
import {
  GuestsService,
  consentSchema,
  groupSchema,
  guestSchema,
  importCommitSchema,
  importPreviewSchema,
  listGuestsSchema,
  updateGuestSchema,
} from './guests.service';
import { SuppressionService, addSuppressionSchema, liftSuppressionSchema } from './suppression.service';

@Controller('v1/workspaces/:workspaceId')
export class GuestsController {
  constructor(
    private readonly svc: GuestsService,
    private readonly suppression: SuppressionService,
  ) {}

  @Get('events/:eventId/guest-groups')
  @Perm('guests:read')
  async groups(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string) {
    return { data: await this.svc.listGroups(ctx, e) };
  }
  @Post('events/:eventId/guest-groups')
  @Perm('guests:write')
  createGroup(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Body(zb(groupSchema)) b: any) {
    return this.svc.createGroup(ctx, e, b.label);
  }
  @Delete('events/:eventId/guest-groups/:groupId')
  @Perm('guests:write')
  @HttpCode(204)
  async deleteGroup(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Param('groupId', uuidParam) g: string) {
    await this.svc.deleteGroup(ctx, e, g);
  }

  @Get('events/:eventId/guests')
  @Perm('guests:read')
  list(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Query(zb(listGuestsSchema)) q: any) {
    return this.svc.list(ctx, e, q);
  }
  @Post('events/:eventId/guests')
  @Perm('guests:write')
  create(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Body(zb(guestSchema)) b: any) {
    return this.svc.create(ctx, e, b);
  }
  @Get('events/:eventId/guests/:guestId')
  @Perm('guests:read')
  get(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('guestId', uuidParam) g: string,
    @Query('reveal') reveal?: string,
  ) {
    const wantReveal = reveal === 'true';
    if (wantReveal && !can(ctx.workspace!.role, 'guests:write')) throw forbidden();
    return this.svc.get(ctx, e, g, wantReveal);
  }
  @Patch('events/:eventId/guests/:guestId')
  @Perm('guests:write')
  update(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('guestId', uuidParam) g: string,
    @Body(zb(updateGuestSchema)) b: any,
  ) {
    return this.svc.update(ctx, e, g, b);
  }
  @Delete('events/:eventId/guests/:guestId')
  @Perm('guests:write')
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Param('guestId', uuidParam) g: string) {
    await this.svc.remove(ctx, e, g);
  }

  @Post('events/:eventId/consents')
  @Perm('consent:write')
  @HttpCode(201)
  consent(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Body(zb(consentSchema)) b: any) {
    return this.svc.recordConsent(ctx, e, b);
  }

  @Post('events/:eventId/imports/preview')
  @Perm('guests:write')
  @HttpCode(201)
  importPreview(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Body(zb(importPreviewSchema)) b: any) {
    return this.svc.importPreview(ctx, e, b);
  }
  @Get('events/:eventId/imports/:importId')
  @Perm('guests:write')
  importGet(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) e: string, @Param('importId', uuidParam) i: string) {
    return this.svc.importGet(ctx, e, i);
  }
  @Post('events/:eventId/imports/:importId/commit')
  @Perm('guests:write')
  async importCommit(
    @Ctx() ctx: RequestCtx,
    @Res({ passthrough: true }) res: Response,
    @Param('eventId', uuidParam) e: string,
    @Param('importId', uuidParam) i: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(zb(importCommitSchema)) b: any,
  ) {
    const r = await this.svc.importCommit(ctx, e, i, key, b);
    res.status(r.status);
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('suppressions')
  @Perm('suppression:read')
  async suppressions(@Ctx() ctx: RequestCtx, @Query('includeLifted') inc?: string) {
    return { data: await this.suppression.list(ctx, inc === 'true') };
  }
  @Post('suppressions')
  @Perm('suppression:manage')
  @HttpCode(201)
  addSuppression(@Ctx() ctx: RequestCtx, @Body(zb(addSuppressionSchema)) b: any) {
    return this.suppression.add(ctx, b);
  }
  @Post('suppressions/:suppressionId/lift')
  @Perm('suppression:manage')
  @HttpCode(200)
  lift(@Ctx() ctx: RequestCtx, @Param('suppressionId', uuidParam) id: string, @Body(zb(liftSuppressionSchema)) b: any) {
    return this.suppression.lift(ctx, id, b.liftReason);
  }
}
export const _z = z;
