# Local development (as implemented)

Prerequisites: Node 22, npm 10, PostgreSQL 16 (Docker or local). Docker is optional.

```bash
npm ci
bash scripts/gen-env.sh            # creates .env with freshly generated random secrets (never committed)
docker compose up -d postgres      # or point DATABASE_URL at any PostgreSQL 16
npm run db:migrate                 # forward-only migrations in db/migrations
npm run db:seed                    # synthetic demo workspace; prints one-time generated passwords
npm run dev                        # API :4000, worker, web :3000 (web proxies /v1 to the API)
```

Open http://localhost:3000, log in with the printed `demo.owner@example.test` password, create/choose a function, **Messages → Test inbox** to open a guest link. API docs: http://localhost:4000/docs.

Whole stack in containers: `docker compose --profile app up --build` (not run in the build sandbox; see PROGRESS.md).

Tests: `npm run test:unit`, `npm run test:integration`, `npm run test:e2e` (the last two need PostgreSQL; set `TEST_DATABASE_URL` or create `shaadicount_test` for the local compose user). Reset the dev database: `npm run db:reset`.

---

# Local Development and Environment Contract

The coding agent must create a runnable local environment. This document describes the minimum expected setup; update commands to match the actual generated repository and pin exact runtime versions in package files.

## Required deliverables
- `.gitignore` excluding `.env`, secrets, build outputs and local databases.
- `.env.example` with placeholder values only.
- Docker Compose for PostgreSQL and any worker dependency actually chosen. Do not add Redis unless the selected implementation uses it.
- Root scripts for install, dev, lint, format-check, typecheck, unit tests, integration tests, end-to-end tests, migration, seed and build.
- Health/readiness endpoints and structured redacted logs.
- CI pipeline running formatting/lint, type-check, tests, migration-from-empty and production build.

## Environment variable rules
Document every variable in `.env.example` with purpose, required/optional status and safe local default. Typical categories: `NODE_ENV`, `PORT`, `DATABASE_URL`, session/token secrets, allowed web origins, public app base URLs, log level, feature flags, provider credentials, provider webhook secret, storage configuration and rate-limit settings.

- Local mode must use fake messaging and synthetic data.
- Never place real provider credentials in the ZIP, repository or test fixtures.
- Fail closed when live messaging is enabled but required policy/provider settings are missing.
- Validate configuration at startup; do not silently fall back from a failed live provider to an unapproved channel.
- Use distinct secrets and databases per environment.

## Expected developer workflow
1. Install the documented runtime and package manager versions.
2. Copy `.env.example` to `.env` and keep all values local.
3. Start dependencies with Docker Compose.
4. Install dependencies using the lockfile-preserving command.
5. Apply migrations and seed synthetic development data.
6. Start API, worker and web app using documented commands.
7. Run the guest RSVP journey using a seeded test event.
8. Run lint, type-check, unit, integration, end-to-end and build commands.

## CI requirements
- Reproducible install from lockfile.
- No secrets required for normal CI.
- Unit/integration tests use ephemeral test database and fake provider.
- Migrations apply to a fresh database.
- Check for accidental secret files and unsafe dependency/configuration patterns.
- End-to-end tests cover public RSVP token abuse/rate limiting, workspace authorization and cross-tenant isolation.
- Deploy only artifacts built from the tested commit; production migration and rollback procedures are documented separately.
