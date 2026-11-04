import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

export const OPENAPI_PATH = join(__dirname, '..', '..', '..', 'api', 'openapi.yaml');

export function loadOpenApi(): any {
  return parse(readFileSync(OPENAPI_PATH, 'utf8'));
}

/** Serves the hand-maintained OpenAPI contract (api/openapi.yaml) at /docs and /v1/openapi.json. */
export function setupDocs(app: INestApplication) {
  if (!existsSync(OPENAPI_PATH)) return;
  const doc = loadOpenApi();
  SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'v1/openapi.json' });
}
