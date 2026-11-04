# Test Strategy

- Unit: RSVP rules, party caps, status transitions, estimate math, eligibility policy.
- Integration: PostgreSQL transactions, outbox relay, queue retries, provider adapters and webhook verification.
- Contract: OpenAPI request/response validation and provider payload fixtures.
- Migration: fresh database, upgrade from previous version, rollback policy and seeded tenant integrity.
- E2E: create event → import guests → send test campaign → guest RSVP → dashboard update → check-in → final report.
- Mobile: supported Android/iOS versions, slow network, app upgrade and session expiry.
- Web: Android Chrome, iOS Safari and common desktop browsers; link previews and safe referrer handling.
- Accessibility/localization: keyboard/screen reader, Hindi labels, number/date formats, long translations and font scaling.
- Security: tenant IDOR, token guessing, CSRF/XSS, rate-limit bypass, CSV injection, webhook forgery, secret scanning.
- Load/failure: RSVP burst, campaign burst, webhook spike, DB pool exhaustion, Redis outage, provider timeout and export overload.
- Recovery: restore PostgreSQL and objects into isolated environment; verify RPO/RTO and integrity.
- Payments/messaging: sandbox only until approved production onboarding.


---

## As implemented

| Layer | Where | What | Run |
|---|---|---|---|
| Unit (53) | `apps/api/src/**/*.spec.ts` | catering arithmetic, phone/CSV/time helpers, import parser, webhook state machine, RSVP count rules, tokens, templates, role invariants, config fail-closed, log redaction | `npm run test:unit` |
| Integration (82) | `apps/api/test/*.int.spec.ts` | real PostgreSQL, real Nest app over HTTP (supertest): auth, tenancy, RSVP, import, messaging worker, webhooks, check-in, privacy, roles, OpenAPI drift, migrations | `npm run test:integration` |
| End-to-end (12) | `apps/api/test/journey.e2e.spec.ts` | one wedding journey: CSV import → consent → schedule → worker → guest link → reminders → dashboard → catering → QR check-in → opt-out → exports/audit | `npm run test:e2e` |
| Web (30) | `apps/web/test` | guest RSVP component (validation, idempotent retry, conflict, Hindi toggle, closed states), UI accessibility primitives, API client, i18n parity | `npm run test -w @shaadicount/web` |
| Smoke (10 checks) | `apps/web/scripts/smoke.mjs` | real Next server → proxy → API → DB over HTTP: headers, cookie/CSRF, event→guest→guest RSVP→dashboard | `npm run test:smoke -w @shaadicount/web` (stack must be running) |

Notes: the integration and e2e projects rebuild the `shaadicount_test` schema from the migrations and must run serially (`--runInBand`, already configured); always invoke them through the npm scripts, not bare `jest`. Secrets are random per test process. **Not covered:** real-browser end-to-end tests (no browser was available in the build sandbox), automated accessibility scanning, load tests, Docker image builds.
