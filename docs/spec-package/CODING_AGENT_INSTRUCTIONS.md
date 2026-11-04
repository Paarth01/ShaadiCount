# Coding Agent Instructions — ShaadiCount

## Mission
Build a secure, testable MVP from this specification. Favor a small, maintainable implementation over a large speculative platform. The result must run locally, have migrations and automated tests, and demonstrate the end-to-end RSVP flow.

## Read before coding
Read in this order:
1. `README.md`
2. `docs/project/implementation-contract.md`
3. `docs/project/decisions-baseline.md`
4. `docs/product/PRD.md`, `docs/product/acceptance-criteria.md`, `docs/product/personas-and-user-stories.md`
5. `docs/architecture/system-overview.md` and all ADRs
6. `docs/database/ERD.md`, `docs/database/schema-reference.md`, `docs/database/migration-plan.md`, `db/001_initial_schema.sql`
7. `docs/api/API_GUIDE.md`, `docs/api/authentication-and-authorization.md`, `api/openapi.yaml`
8. Security, privacy, messaging, UX, testing and DevOps documents

## Non-negotiable rules
- Web-first MVP. Do not build React Native, native apps, AI forecasting, payments, vendor procurement, accommodation management or invitation-design tooling in the first release.
- Do not silently invent unresolved legal, commercial or messaging policy. Record decisions in `docs/project/open-questions.md` and use a safe stub/configurable behavior.
- No live outbound messaging by default. Fake provider/test mode is the default. Live provider integration must be disabled by configuration until an authorized account, approved templates, opt-in evidence, opt-out handling, webhook verification and cost limits are configured and tested.
- Do not send a message merely because a phone number exists. Check documented authorization/consent and channel eligibility before queueing each message.
- Tenant isolation is mandatory. Every workspace-owned read/write must verify membership and workspace scope server-side; never trust a workspace ID from the client alone.
- Never put secrets, full phone numbers, RSVP tokens, raw provider payloads or personal data in logs. Do not commit `.env` or real credentials.
- Do not use production data in local/dev/test environments.
- Keep API contract, migrations, tests and documentation synchronized. Update the relevant documents when implementation requires a justified change.
- Use idempotency for retried mutations and provider webhook deduplication. Design jobs for at-least-once delivery; do not assume exactly-once processing.
- Use explicit event time zones and store timestamps in UTC. Display and schedule using the event's IANA timezone.
- Avoid microservices and unnecessary infrastructure. Start with a modular monolith and a simple worker/outbox pattern.

## Required build phases
### Phase 1 — Repository and foundation
- Create a clear monorepo or repository layout for web, API, database, tests and docs.
- Pin runtime/package versions, add formatting/lint/type-check/test scripts, `.gitignore`, `.env.example`, local Docker Compose and CI.
- Add health/readiness endpoints and structured, redacted logging.
- Confirm the actual versions selected are compatible; document them.

### Phase 2 — Data and access control
- Reconcile the SQL starter with schema reference and migration plan before feature work.
- Add tenant-safe relationships/constraints, migrations, indexes and seed data.
- Implement authentication/session handling and role-based workspace access. Public guest tokens must be random, high entropy, stored as hashes, revocable/expirable, rate-limited and never logged.
- Add tests proving cross-tenant access is denied.

### Phase 3 — Core event/guest/RSVP flow
- Create workspace and event; create event functions with local timezone and RSVP deadline.
- Import/add guest groups and guests; assign invitation eligibility per function.
- Generate public RSVP links; support yes/no/maybe and adult/child counts within invitation limits; allow changes according to deadline and policy.
- Show organizer headcount by function, pending/non-responder list and an audit trail of changes.

### Phase 4 — Messaging and attendance
- Implement campaign preview, recipient eligibility checks, scheduling, quiet/suppression checks, fake provider and delivery-status lifecycle.
- Add provider adapter/webhook contract, deduplication, retry/backoff and pause/cancel behavior. Live sending remains off by default.
- Implement check-in and reconciliation; prevent duplicate active check-ins and make corrections auditable.
- Implement transparent catering calculation with explicit assumptions and no black-box prediction.

### Phase 5 — Hardening and handoff
- Complete API schemas, validation, error handling, accessibility/localization basics, privacy workflows, exports and deletion behavior required by the MVP.
- Run migrations from an empty database, lint, typecheck, unit, integration, security and end-to-end tests.
- Verify all acceptance criteria; add CI and deployment documentation.
- Update open questions, traceability and README. Produce a final implementation report with commands run, test results, known gaps and decisions needing human approval.

## Definition of a finished task
A task is not complete merely because code was written. It must include relevant tests, validation, error handling, documentation updates, and evidence that the intended behavior works. Do not claim a command or test passed unless it was actually run.

## Required final report
1. Implemented features mapped to acceptance criteria.
2. Architecture and stack versions selected.
3. Setup/run instructions and required environment variables.
4. Migration and seed commands.
5. Exact tests/lint/typecheck/build commands and their outcomes.
6. Security/privacy checks performed, including tenant-isolation tests.
7. Disabled integrations and the reason they remain disabled.
8. Remaining blockers, assumptions and human decisions needed.
