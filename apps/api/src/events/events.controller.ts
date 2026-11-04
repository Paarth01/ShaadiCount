import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, Perm, RequestCtx } from '../common/request';
import { uuidParam, zb } from '../common/zod.pipe';
import { EventsService, createEventSchema, createFunctionSchema, updateEventSchema, updateFunctionSchema } from './events.service';

@Controller('v1/workspaces/:workspaceId/events')
export class EventsController {
  constructor(private readonly svc: EventsService) {}

  @Get()
  @Perm('events:read')
  async list(@Ctx() ctx: RequestCtx, @Query(zb(z.object({ includeArchived: z.enum(['true', 'false']).default('false') }))) q: any) {
    return { data: await this.svc.list(ctx, q.includeArchived === 'true') };
  }
  @Post()
  @Perm('events:create')
  create(@Ctx() ctx: RequestCtx, @Body(zb(createEventSchema)) b: any) {
    return this.svc.create(ctx, b);
  }

  @Get(':eventId')
  @Perm('events:read')
  get(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) id: string) {
    return this.svc.get(ctx, id);
  }

  @Patch(':eventId')
  @Perm('events:write')
  update(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) id: string, @Body(zb(updateEventSchema)) b: any) {
    return this.svc.update(ctx, id, b);
  }

  @Post(':eventId/functions')
  @Perm('events:write')
  createFn(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) id: string, @Body(zb(createFunctionSchema)) b: any) {
    return this.svc.createFunction(ctx, id, b);
  }

  @Get(':eventId/functions/:functionId')
  @Perm('events:read')
  getFn(@Ctx() ctx: RequestCtx, @Param('eventId', uuidParam) id: string, @Param('functionId', uuidParam) fid: string) {
    return this.svc.getFunction(ctx, id, fid);
  }

  @Patch(':eventId/functions/:functionId')
  @Perm('events:write')
  updateFn(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) id: string,
    @Param('functionId', uuidParam) fid: string,
    @Body(zb(updateFunctionSchema)) b: any,
  ) {
    return this.svc.updateFunction(ctx, id, fid, b);
  }
}
