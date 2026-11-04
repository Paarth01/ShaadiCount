import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, Perm, RequestCtx } from '../common/request';
import { uuidParam, zb } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import {
  WorkspacesService,
  addMemberSchema,
  assignmentsSchema,
  createWorkspaceSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from './workspaces.service';

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
  action: z.string().max(60).optional(),
});

@Controller('v1')
export class WorkspacesController {
  constructor(
    private readonly svc: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  @Get('workspaces') list(@Ctx() ctx: RequestCtx) {
    return this.svc.list(ctx.user!.id).then((data) => ({ data }));
  }
  @Post('workspaces') create(@Ctx() ctx: RequestCtx, @Body(zb(createWorkspaceSchema)) b: any) {
    return this.svc.create(ctx, b.name);
  }

  @Get('workspaces/:workspaceId')
  @Perm('workspace:read')
  get(@Ctx() ctx: RequestCtx) {
    return this.svc.get(ctx);
  }

  @Patch('workspaces/:workspaceId')
  @Perm('workspace:manage')
  update(@Ctx() ctx: RequestCtx, @Body(zb(updateWorkspaceSchema)) b: any) {
    return this.svc.update(ctx, b);
  }

  @Post('workspaces/:workspaceId/contact-authority-attestation')
  @Perm('workspace:attest')
  @HttpCode(200)
  attest(@Ctx() ctx: RequestCtx, @Body(zb(z.object({ confirm: z.literal(true) }))) _b: any) {
    return this.svc.attestContactAuthority(ctx);
  }

  @Get('workspaces/:workspaceId/members')
  @Perm('members:read')
  members(@Ctx() ctx: RequestCtx) {
    return this.svc.members(ctx).then((data) => ({ data }));
  }

  @Post('workspaces/:workspaceId/members')
  @Perm('members:manage')
  addMember(@Ctx() ctx: RequestCtx, @Body(zb(addMemberSchema)) b: any) {
    return this.svc.addMember(ctx, b);
  }

  @Patch('workspaces/:workspaceId/members/:userId')
  @Perm('members:manage')
  updateMember(@Ctx() ctx: RequestCtx, @Param('userId', uuidParam) userId: string, @Body(zb(updateMemberSchema)) b: any) {
    return this.svc.updateMember(ctx, userId, b.role);
  }

  @Delete('workspaces/:workspaceId/members/:userId')
  @Perm('members:manage')
  @HttpCode(204)
  async removeMember(@Ctx() ctx: RequestCtx, @Param('userId', uuidParam) userId: string) {
    await this.svc.removeMember(ctx, userId);
  }

  @Put('workspaces/:workspaceId/members/:userId/assignments')
  @Perm('members:manage')
  setAssignments(@Ctx() ctx: RequestCtx, @Param('userId', uuidParam) userId: string, @Body(zb(assignmentsSchema)) b: any) {
    return this.svc.setAssignments(ctx, userId, b);
  }

  @Get('workspaces/:workspaceId/usage')
  @Perm('usage:read')
  usage(@Ctx() ctx: RequestCtx) {
    return this.svc.usage(ctx);
  }

  @Get('workspaces/:workspaceId/audit-logs')
  @Perm('audit:read')
  async auditLogs(@Ctx() ctx: RequestCtx, @Query(zb(auditQuery)) q: any) {
    return { data: await this.audit.list(ctx.workspace!.id, q) };
  }
}
