import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CONFIG, Config } from './config/config';
import { AppLogger } from './common/logger';
import { loadEnvFile } from './db/env-file';
import { DispatcherService } from './messaging/dispatcher.service';
import { OutboxRelayService } from './messaging/outbox-relay.service';
import { PrivacyService, RetentionService } from './privacy/privacy.service';

/** Background worker process: message dispatch, outbox relay, scheduled deletions and retention. Run separately from the API. */
async function main() {
  loadEnvFile();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const cfg = app.get<Config>(CONFIG);
  const log = app.get<AppLogger>('LOGGER');
  const dispatcher = app.get(DispatcherService);
  const relay = app.get(OutboxRelayService);
  const privacy = app.get(PrivacyService);
  const retention = app.get(RetentionService);
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.on(sig, () => {
      stopping = true;
      log.info('worker_stopping');
    });
  log.info('worker_started', { messagingMode: cfg.MESSAGING_MODE, pollMs: cfg.WORKER_POLL_MS });
  let tick = 0;
  while (!stopping) {
    try {
      const d = await dispatcher.runOnce();
      const r = await dispatcher.reconcileUnknown();
      const o = await relay.runOnce();
      if (d.claimed || r.claimed || o.published) log.info('worker_tick', { dispatched: d, reconciled: r, outbox: o });
      if (tick++ % 30 === 0) {
        const deleted = await privacy.executeDueDeletions();
        const purged = await retention.runOnce();
        if (deleted) log.info('workspace_deletions_executed', { deleted });
        log.debug('retention', purged);
      }
    } catch (e) {
      log.error('worker_error', { errorName: (e as Error).name, errorMessage: String((e as Error).message).slice(0, 200) });
    }
    await new Promise((res) => setTimeout(res, cfg.WORKER_POLL_MS));
  }
  await app.close();
}
main().catch((e) => {
  process.stderr.write(`Worker failed to start: ${e.message}\n`);
  process.exit(1);
});
