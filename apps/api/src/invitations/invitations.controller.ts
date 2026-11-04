import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Ctx, Perm, RequestCtx } from '../common/request';
import { uuidParam, zb } from '../common/zod.pipe';
import {
  InvitationsService,
  createInvitationsSchema,
  listInvitationsSchema,
  reasonSchema,
  updateInvitationSchema,
} from './invitations.service';
import { RsvpService, overrideSchema } from '../rsvp/rsvp.service';

const BASE = 'v1/workspaces/:workspaceId/events/:eventId/functions/:functionId/invitations';

@Controller(BASE)
export class InvitationsController {
  constructor(
    private readonly svc: InvitationsService,
    private readonly rsvp: RsvpService,
  ) {}

  @Get()
  @Perm('guests:read')
  list(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Query(zb(listInvitationsSchema)) q: any,
  ) {
    return this.svc.list(ctx, e, f, q);
  }
  @Post()
  @Perm('invitations:write')
  @HttpCode(201)
  create(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Body(zb(createInvitationsSchema)) b: any,
  ) {
    return this.svc.create(ctx, e, f, b);
  }
  @Patch(':invitationId')
  @Perm('invitations:write')
  update(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('invitationId', uuidParam) i: string,
    @Body(zb(updateInvitationSchema)) b: any,
  ) {
    return this.svc.update(ctx, e, f, i, b);
  }
  @Post(':invitationId/revoke')
  @Perm('invitations:write')
  @HttpCode(200)
  revoke(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('invitationId', uuidParam) i: string,
    @Body(zb(reasonSchema)) b: any,
  ) {
    return this.svc.revoke(ctx, e, f, i, b.reason);
  }
  @Post(':invitationId/restore')
  @Perm('invitations:write')
  @HttpCode(200)
  restore(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('invitationId', uuidParam) i: string,
  ) {
    return this.svc.restore(ctx, e, f, i);
  }
  @Post(':invitationId/rotate-token')
  @Perm('invitations:write')
  @HttpCode(200)
  rotate(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('invitationId', uuidParam) i: string,
    @Body(zb(reasonSchema)) b: any,
  ) {
    return this.svc.rotate(ctx, e, f, i, b.reason);
  }
  @Get(':invitationId/link')
  @Perm('invitations:write')
  link(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('invitationId', uuidParam) i: string,
  ) {
    return this.svc.link(ctx, e, f, i);
  }
  @Get(':invitationId/history')
  @Perm('guests:read')
  history(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('invitationId', uuidParam) i: string,
  ) {
    return this.svc.history(ctx, e, f, i);
  }
  @Put(':invitationId/response')
  @Perm('rsvp:override')
  override(
    @Ctx() ctx: RequestCtx,
    @Param('eventId', uuidParam) e: string,
    @Param('functionId', uuidParam) f: string,
    @Param('invitationId', uuidParam) i: string,
    @Body(zb(overrideSchema)) b: any,
  ) {
    return this.rsvp.override(ctx, e, f, i, b);
  }
}
