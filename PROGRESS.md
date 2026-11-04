# Progress tracker

Last verified: full test, lint, typecheck and build pass on the final code (numbers below). Legend: ✅ done and tested · 🟡 done with a stated limitation · ❌ not done.

## Requirements

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Audit the ZIP; resolve conflicts/gaps | ✅ | [docs/project/spec-audit.md](docs/project/spec-audit.md), ADRs 004-007 |
| 2 | Stack: Next.js, TypeScript, NestJS, PostgreSQL, versioned REST, modular monolith | ✅ | Versions pinned to validated majors |
| 3a | Secure authentication | 🟡 | Email+password, sessions, CSRF, rate limits. No email verification, password reset or MFA |
| 3b | Event and function management | ✅ | IANA time zones, DST-correct, deadlines, capacity, child policy, edit policy, statuses |
| 3c | Guest management | ✅ | Groups, masked contacts, duplicate detection, erasure |
| 3d | CSV import/export | ✅ | Preview → commit (idempotent), mapping auto-detect, formula-injection-safe exports |
| 3e | Personalised RSVP links | ✅ | One link per guest per function, hash-only storage, rotate/revoke, fragment URLs |
| 3f | RSVP dashboards and reporting | ✅ | Per function/event, non-responders, capacity status, reconciliation, 4 CSV exports |
| 4 | Mock messaging provider + reminder workflow; live disabled by default | 🟡 | Fake provider, worker, webhooks, sandbox inbox, live gate fails closed. Reminders are organizer-created campaigns; automatic cadence rules not built. **No live adapter by design** |
| 5 | Polished responsive mobile-first UI on real data | 🟡 | 13 pages, bottom nav on phones, EN/HI guest page. Organizer UI is English only; verified by jsdom tests + smoke, **not in a real browser** |
| 6a | Migrations, validation, tenant isolation, authorisation, audit logging, security protections | ✅ | Composite FKs, role matrix, append-only audit, headers, CSRF, rate limits, body caps |
| 6b | API documentation | ✅ | `api/openapi.yaml` (80 operations) served at `/docs`; drift test |
| 7 | Unit, integration, e2e tests; run and fix; verify production build | ✅ | See results |
| 8 | Docker/local config, env example, seed, setup instructions | 🟡 | Written; **Docker images and compose not built/run** (no Docker in the sandbox). Seed and local run verified |
| 9 | Update documentation; progress file | ✅ | This file; traceability maps every acceptance-matrix ID to tests |
| 10 | Keep going until the MVP works | ✅ | Full journey runs end to end over HTTP |

## Verification results

| Check | Result |
|---|---|
| API unit | 53 passed |
| API integration (PostgreSQL) | 82 passed in 6 suites: foundation, core, messaging, ops, compliance, openapi |
| End-to-end journey | 12 passed |
| Web (Vitest/Testing Library) | 30 passed |
| HTTP smoke (Next production server → proxy → API → DB) | 10 checks passed; also run against the standalone server layout used by the Dockerfile |
| `eslint`, `tsc --noEmit` (strict), `prettier --check` | clean (both apps) |
| `next build`, API `tsc` build | succeed |
| Migrations | apply to an empty DB on every test run; idempotent; edit-after-apply rejected; failing migration rolls back atomically |
| `npm audit --omit=dev` | 8 → 2 findings after upgrades/overrides: PostCSS (via Next 15, build-time, needs Next 16). Accepted and documented |
| Secret scan | clean |

## Incomplete or not verified (be aware before relying on this)

- ❌ **Live WhatsApp/SMS/email delivery**: intentionally absent. Needs a chosen provider, credentials, approved templates, consent/opt-out policy, then an adapter + tests.
- ❌ Email verification, password reset, MFA/SSO.
- ❌ Automatic reminder cadence (e.g. "3 days before deadline"); billing/subscriptions; walk-in registration; offline check-in; one-link-per-household across functions.
- ❌ PostgreSQL row-level security (isolation is enforced in code + composite FKs, both tested).
- 🟡 In-memory rate limiter (single API instance).
- 🟡 CSP allows inline scripts (strict nonce mode unverified without a browser).
- ❓ Not run: real-browser E2E, automated accessibility scan, camera QR scanning, load tests, Docker builds, GitHub Actions, penetration test, legal/DPDP review, native proofreading of Hindi text.
- 🟡 Message cost figures are placeholders, not provider pricing.

## Assumptions made

Listed in [docs/project/open-questions.md](docs/project/open-questions.md) ("Resolved during implementation"). The most consequential: guests are event-scoped; collaborators must register before being added; catering formula and defaults; quiet hours 21:00-09:00; 7-day retention for exports/import files and a 7-day deletion grace period.

## Environment notes

Built in a Linux sandbox without Docker or a browser: PostgreSQL 16 was installed from apt, the compiled API/worker/web were run directly, and the registry's newest majors (Nest 12, TypeScript 7, ESLint 10) were deliberately not adopted because they could not be validated against this code.
