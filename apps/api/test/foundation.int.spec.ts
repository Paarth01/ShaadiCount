import request from 'supertest';
import { Client, createTestApp, TestCtx } from './helpers';

describe('foundation: auth, CSRF, tenancy', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('rejects unauthenticated access with 401', async () => {
    const r = await request(t.app.getHttpServer()).get('/v1/workspaces');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('registers, sets HttpOnly cookie, and blocks mutations without CSRF token', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'a-foundation@example.test', password: 'Correct-Horse-Battery-9', displayName: 'A', workspaceName: 'WS A' });
    expect(res.status).toBe(201);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const noCsrf = await request(t.app.getHttpServer()).post('/v1/workspaces').set('Cookie', cookie.split(';')[0]).send({ name: 'x' });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('hides another tenant workspace behind a generic 404 and records a security event', async () => {
    const a = await Client.register(t.app, { workspaceName: 'Tenant A' });
    const b = await Client.register(t.app, { workspaceName: 'Tenant B' });
    const r = await b.get(`/v1/workspaces/${a.workspaceId}`);
    expect(r.status).toBe(404);
    const missing = await b.get('/v1/workspaces/00000000-0000-4000-8000-000000000000');
    expect(missing.body.error.message).toBe(r.body.error.message);
    const sec = await t.db.query(`SELECT 1 FROM audit_logs WHERE actor_user_id=$1 AND action='security.workspace_access_denied'`, [
      b.userId,
    ]);
    expect(sec.length).toBeGreaterThan(0);
  });
});
