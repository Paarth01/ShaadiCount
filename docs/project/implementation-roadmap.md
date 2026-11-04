# Implementation Roadmap

## Phase 0 — Discovery and feasibility
- Interview hosts/planners/caterers; validate willingness to pay and current workflows.
- Select messaging provider candidates and confirm official onboarding, template, pricing and webhook behavior.
- Legal review of privacy, telecom, consent and payment obligations.
- Done when assumptions, pilot cohort and provider constraints are recorded.

## Phase 1 — Product and architecture
- Approve PRD, roles, event/function model, state transitions, ADRs, API contract and retention policy.
- Review diagrams against data model.
- Done when critical open questions have owners and MVP scope is frozen.

## Phase 2 — Foundation
- Repo, CI, environments, auth, workspace tenancy, migrations, audit logging and rate limits.
- Tests: cross-tenant denial, migration up/down and session security.

## Phase 3 — Events, guests and import
- Event/function CRUD, groups, guest CRUD, import preview/commit and duplicate review.
- Tests: partial import, formula injection, idempotent commit.

## Phase 4 — RSVP
- Secure token issuance/hash/revocation, guest web, response edits, deadline and party cap.
- Tests: concurrency, token expiry, per-function isolation and count integrity.

## Phase 5 — Messaging
- Provider adapter, templates, consent/preferences, outbox, scheduler, webhooks, retries and suppression.
- Critical path depends on provider validation and approved templates.
- Tests: duplicate webhook, timeout/unknown, opt-out during campaign and outage recovery.

## Phase 6 — Dashboard and catering
- Aggregates, scenarios, exports and estimate-vs-actual views.
- Tests: query correctness, rounding, large exports and access filtering.

## Phase 7 — Check-in
- QR/manual lookup, unique check-in, staff permissions and reports.
- Tests: duplicate scans, concurrent scans and partial attendance labels.

## Phase 8 — Hardening
- Threat-model controls, accessibility, localization, load/failure tests, backups, alerts, runbooks and legal sign-off.

## Phase 9 — Pilot and launch
- Staging rehearsal, selected pilot events, incident support, post-event interviews and metric review.
- Launch only after acceptance gates, restore test and provider/legal readiness.

Critical path: data model/tenant isolation → per-function invitation/RSVP → outbox and provider validation → dashboard → pilot. Billing and advanced analytics are outside MVP.

## MVP pilot guardrails
- Follow `docs/project/implementation-contract.md` and `docs/project/decisions-baseline.md`; the pilot is web-first and planner-first is a hypothesis to validate.
- Complete the release checklist and obtain human review of provider/legal dependencies before live messaging.
- Measure RSVP-to-check-in and catering inputs honestly; do not claim food-waste reduction without measured prepared/served/leftover meal data and a credible baseline.
