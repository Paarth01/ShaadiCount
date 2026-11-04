import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters';
import type { AppLogger } from './common/logger';
import type { Config } from './config/config';
import { CONFIG } from './config/config';

/** Shared by main.ts and the test harness so tests exercise the same middleware stack as production. */
export function configureApp(app: INestApplication, cfg: Config, logger: AppLogger) {
  const x = app as NestExpressApplication;
  x.set('trust proxy', cfg.TRUST_PROXY);
  x.disable('x-powered-by');
  // Strict CSP for the JSON API; the interactive API docs page needs its own relaxed policy.
  const strict = helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  const docs = helmet({ contentSecurityPolicy: false, referrerPolicy: { policy: 'no-referrer' } });
  x.use((req: any, res: any, next: any) => (req.path.startsWith('/docs') ? docs(req, res, next) : strict(req, res, next)));
  x.use((req: any, res: any, next: any) => {
    // API responses can contain personal data: never cache.
    if (!req.path.startsWith('/docs')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Small JSON bodies by default (bounds validation work/memory on every route); only the CSV import preview may be ~1 MB.
  // rawBody is kept for webhook signature verification. body-parser skips a request that an earlier parser already consumed.
  const keepRaw = (req: any, _res: any, buf: Buffer) => {
    req.rawBody = buf;
  };
  x.use('/v1/workspaces/:workspaceId/events/:eventId/imports/preview', json({ limit: '1mb', verify: keepRaw }));
  x.use(json({ limit: '100kb', verify: keepRaw }));
  x.use(cookieParser());
  x.useGlobalFilters(new AllExceptionsFilter(logger));
  x.useLogger(logger);
}

export { CONFIG };
