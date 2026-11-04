import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';

export interface RouteInfo {
  method: string;
  path: string;
  handler: string;
}

/** Lists every registered HTTP route as `METHOD /openapi/style/{params}`; used by the OpenAPI drift test. */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const out: RouteInfo[] = [];
  const modules = app.get(ModulesContainer, { strict: false });
  const controllers = [...modules.values()].flatMap((m) => [...m.controllers.values()]);
  for (const w of controllers) {
    const ctor = w.metatype as any;
    if (!ctor) continue;
    const base: string = Reflect.getMetadata('path', ctor) ?? '';
    for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
      const fn = ctor.prototype[name];
      if (typeof fn !== 'function' || name === 'constructor') continue;
      const method = Reflect.getMetadata('method', fn);
      if (method === undefined) continue;
      const sub: string = Reflect.getMetadata('path', fn) ?? '';
      const full = ('/' + [base, sub].filter(Boolean).join('/')).replace(/\/+/g, '/').replace(/\/$/, '');
      out.push({ method: RequestMethod[method], path: full.replace(/:([A-Za-z]+)/g, '{$1}'), handler: `${ctor.name}.${name}` });
    }
  }
  return out.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}
