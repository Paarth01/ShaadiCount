import { createTestApp, TestCtx } from './helpers';
import { listRoutes } from '../src/common/routes';
import { loadOpenApi } from '../src/docs';
import request from 'supertest';

describe('OpenAPI contract', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('documents exactly the routes the server implements (no drift in either direction)', () => {
    const doc = loadOpenApi();
    const documented = new Set<string>();
    for (const [p, item] of Object.entries<any>(doc.paths)) for (const m of Object.keys(item)) documented.add(`${m.toUpperCase()} ${p}`);
    const implemented = new Set(listRoutes(t.app).map((r) => `${r.method} ${r.path}`));
    expect([...implemented].filter((r) => !documented.has(r))).toEqual([]);
    expect([...documented].filter((r) => !implemented.has(r))).toEqual([]);
  });
  it('requires an Idempotency-Key header on every operation the server enforces it for', () => {
    const doc = loadOpenApi();
    const need = ['/imports/{importId}/commit', '/campaigns/{campaignId}/schedule', '/v1/public/rsvp/{token}/response'];
    for (const suffix of need) {
      const [path] = Object.entries<any>(doc.paths).find(([p]) => p.endsWith(suffix))!;
      const op: any = Object.values(doc.paths[path]).find((o: any) => o.parameters?.some((p: any) => p.name === 'Idempotency-Key'));
      expect(op).toBeTruthy();
    }
  });
  it('marks every non-public operation as session + CSRF protected and every public one as open', () => {
    const doc = loadOpenApi();
    for (const [p, item] of Object.entries<any>(doc.paths))
      for (const [m, op] of Object.entries<any>(item)) {
        const isPublic =
          p.startsWith('/v1/public') ||
          p.startsWith('/v1/webhooks') ||
          p.startsWith('/v1/health') ||
          ['/v1/auth/login', '/v1/auth/register'].includes(p);
        expect({ route: `${m} ${p}`, open: Array.isArray(op.security) && op.security.length === 0 }).toEqual({
          route: `${m} ${p}`,
          open: isPublic,
        });
      }
  });
  it('is a valid-looking OpenAPI 3.1 document with every $ref resolvable', () => {
    const doc = loadOpenApi();
    expect(doc.openapi).toBe('3.1.0');
    const refs = JSON.stringify(doc).match(/#\/components\/[A-Za-z]+\/[A-Za-z0-9]+/g) ?? [];
    for (const r of new Set(refs)) {
      const [, , kind, name] = r.split('/');
      expect(doc.components[kind][name]).toBeDefined();
    }
  });
  it('serves the contract as JSON when docs are enabled (setupDocs)', async () => {
    const withDocs = await createTestApp({}, { docs: true });
    try {
      const r = await request(withDocs.app.getHttpServer()).get('/v1/openapi.json');
      expect(r.status).toBe(200);
      expect(r.body.info.title).toBe('ShaadiCount API');
      const ui = await request(withDocs.app.getHttpServer()).get('/docs');
      expect(ui.status).toBe(200);
    } finally {
      await withDocs.close();
    }
  });
});
