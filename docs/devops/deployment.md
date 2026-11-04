# Deployment and CI/CD

## Environments
Separate development, staging and production accounts/projects, databases, secrets and provider credentials. Never copy production guest data into development.

## CI pipeline
1. Format/lint/type-check.
2. Unit and integration tests.
3. OpenAPI validation and migration checks.
4. Dependency and secret scan.
5. Build immutable container artifact.
6. Deploy to staging; run smoke/E2E tests.
7. Production approval, migration compatibility check and gradual release.
8. Monitor error rate, p95 latency, queue lag and provider failures; rollback app version if needed.

## Configuration
Use secret manager for credentials. `.env.example` may contain placeholders only. Keep database migrations backward-compatible during rolling deployments. Feature flags protect provider rollout and billing launch.

## Backups and recovery
Automated encrypted database backups and point-in-time recovery where supported; object storage versioning/lifecycle as appropriate. Define RPO/RTO with business owner and perform restore drills. Backups are not considered verified until restore is tested.


---

## As implemented: deploying this repository

Artifacts: `Dockerfile.api` (API and worker, same image), `Dockerfile.web` (Next.js standalone, `API_URL` baked in at build), `docker-compose.yml`, `.github/workflows/ci.yml`.

1. **Run migrations first**: `node apps/api/dist/db/migrate-cli.js` (advisory-locked, checksum-verified, forward-only; take a backup beforehand).
2. **Processes**: 1+ API (`node apps/api/dist/main.js`), exactly one or more workers (`node apps/api/dist/worker.js`; safe to run several), and the web server. The worker must be running or no message is ever sent and no reminder is cancelled.
3. **Required secrets** (from a secret manager, never the repo): `DATABASE_URL`, `CSRF_SECRET`, `RSVP_TOKEN_SECRET`, `PSEUDONYM_SECRET`, `MESSAGING_WEBHOOK_SECRET` (all ≥ 32 chars). `RSVP_TOKEN_SECRET` rotation invalidates every issued link/QR; plan it like a key ceremony (re-issue links from the app afterwards).
4. **HTTPS is required** with `NODE_ENV=production` (session cookies are `Secure`). Set `WEB_ORIGINS` and `PUBLIC_APP_URL` to the public https origin, and `TRUST_PROXY` to the number of proxies in front of the API so rate limits see client IPs.
5. **Single-instance assumption**: the rate limiter is in memory. Run one API instance, or replace it with a shared store first.
6. **Messaging stays in sandbox mode** unless every `LIVE_*` safeguard is configured *and* a real provider adapter has been written; see `docs/messaging/provider-integration.md`. In production the sandbox provider does not store message bodies.
7. **Health**: `GET /v1/health` (liveness), `GET /v1/health/ready` (database). Logs are JSON on stdout with a request id and mandatory redaction.
8. **Backups/retention**: back up PostgreSQL (it is the only stateful store; exports and import files live in it temporarily). Retention jobs run inside the worker; deletion requests execute after `DELETION_GRACE_DAYS`.
