import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { CONFIG, Config } from './config/config';
import { AppLogger } from './common/logger';
import { loadEnvFile } from './db/env-file';
import { setupDocs } from './docs';

async function bootstrap() {
  loadEnvFile();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  const cfg = app.get<Config>(CONFIG);
  const logger = app.get<AppLogger>('LOGGER');
  configureApp(app, cfg, logger);
  setupDocs(app, cfg.DOCS_ENABLED);
  app.enableShutdownHooks();
  await app.listen(cfg.PORT, '0.0.0.0');
  logger.info('api_listening', { port: cfg.PORT, messagingMode: cfg.MESSAGING_MODE });
}
bootstrap().catch((e) => {
  process.stderr.write(`Startup failed: ${e.message}\n`);
  process.exit(1);
});
