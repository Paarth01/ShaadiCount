import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CONFIG, Config, loadConfig } from '../config/config';
import { AppLogger } from './logger';
import { DbService } from './db.service';
import { RateLimitService } from './rate-limit.service';
import { IdempotencyService } from './idempotency.service';
import { ScopeService } from './scope.service';
import { AuditService, AnalyticsService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { AccessGuard } from '../auth/access.guard';

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: (): Config => loadConfig() },
    { provide: 'LOGGER', useFactory: (c: Config) => new AppLogger(c.LOG_LEVEL), inject: [CONFIG] },
    DbService,
    RateLimitService,
    IdempotencyService,
    ScopeService,
    AuditService,
    AnalyticsService,
    SessionService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [
    CONFIG,
    'LOGGER',
    DbService,
    RateLimitService,
    IdempotencyService,
    ScopeService,
    AuditService,
    AnalyticsService,
    SessionService,
  ],
})
export class CommonModule {}
