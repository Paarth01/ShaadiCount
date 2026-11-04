import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CONFIG, Config } from '../src/config/config';
import { AppLogger } from '../src/common/logger';
import { DbService } from '../src/common/db.service';

export interface TestCtx {
  app: INestApplication;
  db: DbService;
  cfg: Config;
  close: () => Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}, opts: { docs?: boolean } = {}): Promise<TestCtx> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ bodyParser: false, logger: false });
  const cfg = app.get<Config>(CONFIG);
  configureApp(app, cfg, app.get<AppLogger>('LOGGER'));
  if (opts.docs) (await import('../src/docs')).setupDocs(app);
  await app.init();
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return { app, db: app.get(DbService), cfg, close: () => app.close() };
}

/** A logged-in browser-like client: keeps the session cookie and sends the CSRF header on mutations. */
export class Client {
  cookie = '';
  csrf = '';
  userId = '';
  workspaceId = '';
  constructor(
    private readonly app: INestApplication,
    public email: string,
  ) {}

  static async register(app: INestApplication, opts: { email?: string; name?: string; workspaceName?: string } = {}) {
    const email = opts.email ?? `user-${randomUUID()}@example.test`;
    const c = new Client(app, email);
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'Correct-Horse-Battery-9', displayName: opts.name ?? 'Test User', workspaceName: opts.workspaceName });
    if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
    c.cookie = (res.headers['set-cookie'] as unknown as string[]).map((x) => x.split(';')[0]).join('; ');
    c.csrf = res.body.csrfToken;
    c.userId = res.body.user.id;
    c.workspaceId = res.body.workspaceId;
    return c;
  }

  private req(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown, headers: Record<string, string> = {}) {
    let r = (request(this.app.getHttpServer()) as any)[method](path).set('Cookie', this.cookie);
    if (method !== 'get') r = r.set('X-CSRF-Token', this.csrf);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return body === undefined ? r : r.send(body);
  }
  get = (p: string, h?: Record<string, string>) => this.req('get', p, undefined, h);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.req('post', p, b ?? {}, h);
  put = (p: string, b?: unknown, h?: Record<string, string>) => this.req('put', p, b ?? {}, h);
  patch = (p: string, b?: unknown, h?: Record<string, string>) => this.req('patch', p, b ?? {}, h);
  del = (p: string, h?: Record<string, string>) => this.req('delete', p, undefined, h);
}

export const idem = () => ({ 'Idempotency-Key': `test-${randomUUID()}` });
export const pub = (app: INestApplication) => request(app.getHttpServer());
