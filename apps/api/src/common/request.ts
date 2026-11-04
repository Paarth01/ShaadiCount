import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission, Role } from '../auth/permissions';

export interface RequestCtx {
  requestId: string;
  ip: string;
  user?: { id: string; email: string; displayName: string };
  sessionId?: string;
  workspace?: { id: string; role: Role; name: string };
}
export type AppRequest = Request & { ctx: RequestCtx; rawBody?: Buffer };

export const Ctx = createParamDecorator((_d: unknown, c: ExecutionContext): RequestCtx => c.switchToHttp().getRequest<AppRequest>().ctx);
export const Req = createParamDecorator((_d: unknown, c: ExecutionContext): AppRequest => c.switchToHttp().getRequest<AppRequest>());

export const PUBLIC_KEY = 'isPublic';
export const PERM_KEY = 'perm';
/** Route needs no session (public RSVP, health, webhooks, login). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Workspace permission required (role matrix in auth/permissions.ts). Requires :workspaceId in the route. */
export const Perm = (...p: Permission[]) => SetMetadata(PERM_KEY, p);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
