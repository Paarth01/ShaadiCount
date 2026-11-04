# Initial Implementation Backlog

Use these as epics/tasks; split into small pull requests. Dependencies are intentional.

## EPIC 0 — Specification reconciliation
- [ ] Audit PRD, UX, OpenAPI and SQL for mismatches.
- [ ] Complete endpoint inventory and JSON schemas.
- [ ] Reconcile database relationships, status enums and role matrix.
- [ ] Resolve auth approach and document ADR.

## EPIC 1 — Repository foundation
- [ ] Create web/API packages with pinned runtime and package manager.
- [ ] Add lint, format, typecheck, unit-test, integration-test, e2e and build scripts.
- [ ] Add local PostgreSQL Compose, `.env.example`, `.gitignore`, CI.
- [ ] Add health/readiness endpoints, request IDs and redacted logging.

## EPIC 2 — Identity and tenant boundary
- [ ] Implement authentication/session lifecycle.
- [ ] Implement workspace membership and role authorization.
- [ ] Add tenant-safe migrations and cross-tenant denial tests.
- [ ] Add audit event helper and sensitive-data logging tests.

## EPIC 3 — Events, guests and invitations
- [ ] CRUD workspace/event/function.
- [ ] Guest groups, guest CRUD and CSV import preview/commit.
- [ ] Function-specific invitation creation, token hashing, expiry and revocation.
- [ ] Public RSVP page with deadline, party-size validation and optimistic version.
- [ ] Organizer dashboard and response history.

## EPIC 4 — Messaging test mode
- [ ] Campaign preview and recipient eligibility calculation.
- [ ] Fake provider and normalized message status model.
- [ ] Outbox/worker, retries, idempotency and webhook deduplication tests.
- [ ] Pause/cancel, opt-out/suppression and cost/rate limit hooks.
- [ ] Live provider stays feature-flagged off.

## EPIC 5 — Check-in and catering
- [ ] Check-in lookup/scan flow and duplicate prevention.
- [ ] Audited correction flow.
- [ ] Explainable catering calculation with assumptions and exports.
- [ ] Reconciliation dashboard: RSVP counts vs actual check-ins.

## EPIC 6 — Release hardening
- [ ] Data export/deletion workflows and retention implementation.
- [ ] Accessibility, Hindi/English, slow-network and mobile-browser checks.
- [ ] Complete acceptance matrix and API documentation.
- [ ] Security review, backup restore test, deployment/rollback rehearsal.
- [ ] Pilot metrics and release-readiness checklist reviewed by human owner.
