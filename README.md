# ShaadiCount

Mobile-first SaaS for Indian weddings: organisers manage events and **wedding functions** (Mehendi, Sangeet, Ceremony, Reception…), guest lists, **function-specific RSVPs** via personal links, consent-gated reminders, live attendance dashboards, catering estimates and QR check-in.

**Status: functional MVP.** Everything below is implemented and tested against a real PostgreSQL database, with the exceptions listed in [PROGRESS.md](PROGRESS.md) and [docs/security/known-limitations.md](docs/security/known-limitations.md). **Real WhatsApp/SMS/email sending is not implemented and is disabled by design**: messaging runs on a sandbox provider.

## What you get

| Area | Highlights |
|---|---|
| Organiser app (Next.js, mobile-first) | Events, functions (time-zone-correct), guests and groups, CSV import wizard with duplicate/error preview, invitations, per-guest links, RSVP corrections with history, campaigns with recipient/cost preview, catering, check-in mode with camera QR scan, team & roles, opt-outs, audit log, data export/deletion |
| Guest page (`/r#token`) | English/Hindi, adults/children counts, retry-safe submission, edit until the deadline, QR for entry, safe states for expired/revoked/closed links |
| API (NestJS modular monolith) | Versioned REST `/v1`, zod validation, sessions + CSRF, tenant isolation, role matrix, idempotency keys, optimistic concurrency, audit log, OpenAPI at `/docs` (on by default outside production; set `DOCS_ENABLED=true` to expose it in production) |
| Worker | Postgres outbox + `SKIP LOCKED` dispatcher with leases, retries/backoff, dead-lettering, provider-timeout reconciliation, quiet hours, retention and scheduled deletions |
| Messaging safety | Fake provider by default; live mode fails closed; consent evidence, attestation, opt-out suppression, cost confirmation and spend cap |

```
Browser ──► Next.js (web) ──/v1 proxy──► NestJS API ──► PostgreSQL ◄── Worker (dispatch, outbox, retention)
 guest /r#token                              │                              │
                                             └── audit log, outbox          └── Fake provider (sandbox) ◄─ signed webhooks
```

## Quick start

Requirements: Node 22, npm 10, PostgreSQL 16 (via Docker or local).

```bash
npm ci
bash scripts/gen-env.sh          # .env with freshly generated random secrets (git-ignored)
docker compose up -d postgres    # or set DATABASE_URL to any PostgreSQL 16
npm run db:migrate
npm run db:seed                  # synthetic demo data; prints one-time generated passwords
npm run dev                      # API :4000 · worker · web :3000
```

Open <http://localhost:3000> and log in as `demo.owner@example.test` with the password the seed printed (there are no default or hard-coded credentials). Then: **Events → Aarav & Diya Wedding → a function → Messages**, create and schedule a campaign (the demo already has consent recorded for 28 guests), and open **Test inbox → Open guest link** to try the guest experience. API reference: <http://localhost:4000/docs>.

Everything in containers: `docker compose --profile app up --build`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API + worker + web with reload |
| `npm run db:migrate` / `db:seed` / `db:reset` | Migrations (forward-only, checksummed), demo data, clean reset (refuses in production) |
| `npm run lint` · `npm run typecheck` · `npm run format:check` | Static checks |
| `npm run test:unit` · `test:integration` · `test:e2e` | Test suites (integration/e2e need PostgreSQL; set `TEST_DATABASE_URL` if not using the compose defaults) |
| `npm run build` | Production builds (API → `dist`, web → Next standalone) |
| `npm run test:smoke` | HTTP smoke test against a running stack (start it first) |
| `npm run check:secrets` | Secret scan |
| `node scripts/gen-openapi.mjs` | Regenerate `api/openapi.yaml` (a test fails if it drifts from the router) |

## Verified results (build sandbox, Node 22, PostgreSQL 16)

| Check | Result |
|---|---|
| API unit tests | 53 passed |
| API integration tests (real PostgreSQL, HTTP) | 82 passed (6 suites) |
| End-to-end journey (import → consent → send → guest RSVP → reminder → dashboard → catering → check-in → opt-out) | 12 passed |
| Web component/unit tests | 30 passed |
| HTTP smoke test (Next server → proxy → API → DB) | 10 checks passed |
| ESLint, TypeScript (strict), Prettier | clean |
| Production builds (API, Next.js, standalone server) | succeed |
| `npm audit --omit=dev` | 2 remaining findings (PostCSS via Next 15, build-time only; documented risk acceptance) |

**Not verified here:** real-browser behaviour, camera QR scanning, automated accessibility audit, Docker image builds, the GitHub Actions run, load testing, legal/DPDP review. Details in [PROGRESS.md](PROGRESS.md).

## Messaging safety in one paragraph

Importing contacts never authorises messaging. A workspace owner/organizer must attest authority to contact guests once; permission evidence must be recorded per guest and channel; opt-outs (including provider "STOP" callbacks) suppress a contact permanently across campaigns and survive guest deletion; sends respect quiet hours in the event's time zone, a per-minute rate limit and a spend cap; the organizer must confirm the exact recipient count and estimated cost; eligibility is re-checked right before every provider call; timeouts are reconciled with the same idempotency key so a guest is never messaged twice. `MESSAGING_MODE=live` refuses to start unless every safeguard in `.env.example` is configured, and even then the repository ships **no** real provider adapter. See [docs/messaging/provider-integration.md](docs/messaging/provider-integration.md).

## Repository layout

```
apps/api      NestJS API + worker (src/<module>: auth, workspaces, events, guests, invitations, rsvp, reporting, messaging, checkin, privacy, audit)
apps/web      Next.js app (app/ routes, components/, lib/) and smoke test
db/migrations Forward-only SQL migrations (source of truth for the schema)
api/          openapi.yaml (generated by scripts/gen-openapi.mjs)
docs/         Specification package, ADRs 001-007, security, privacy, messaging, devops, traceability
scripts/      gen-env, gen-openapi, check-secrets
```

## Key decisions and deviations from the spec package

See [docs/project/spec-audit.md](docs/project/spec-audit.md) and ADRs [004](docs/architecture/ADRs/ADR-004-derived-invitation-tokens.md) (hash-only derived tokens), [005](docs/architecture/ADRs/ADR-005-workspace-scoped-api-and-concealment.md) (workspace-scoped API), [006](docs/architecture/ADRs/ADR-006-session-auth-csrf.md) (sessions + CSRF) and [007](docs/architecture/ADRs/ADR-007-postgres-worker-no-redis-mvp.md) (Postgres worker instead of Redis for the MVP).

## Requirements

Node ≥ 22.12, npm ≥ 10, PostgreSQL 16. Dependencies are pinned to major versions that were validated (Nest 11, Next 15, React 19, zod 4, TypeScript 5.9); newer majors exist in the registry but were not validated.
