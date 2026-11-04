# Requirements Traceability

Keep this table synchronized as code is implemented. Replace `Planned` with a link to the test/PR and a status only after verification.

| Requirement | Primary specification | Implementation area | Verification | Status |
|---|---|---|---|---|
| Workspace isolation | implementation-contract; tenant-isolation-checklist | API authorization, database | TENANT-01, DB-01 | Planned |
| Event/functions/timezones | PRD; screen specifications | events/functions | EVENT-01, TIME-01 | Planned |
| Guest import | implementation-contract; schema reference | guest/import module | GUEST-01 | Planned |
| Function-specific invitations | implementation-contract; ERD | invitations | INV-01 | Planned |
| Public RSVP and edit history | acceptance criteria; API guide | RSVP module | RSVP-01..05 | Planned |
| Permission-based messaging | provider-adapter-contract; templates/policies | messaging module | MSG-01..06 | Planned |
| Check-in/reconciliation | implementation-contract | check-in module | CHECKIN-01..02 | Planned |
| Catering estimates | implementation-contract | reporting/calculation module | CATER-01..02 | Planned |
| Exports/privacy workflow | privacy docs; security checklist | export/privacy modules | PRIV-02 | Planned |
| CI/local setup | local-development; testing strategy | repository/CI | DB-01 and CI pipeline | Planned |
| Release gate | release-readiness-checklist | deployment/process | checklist evidence | Planned |


---

## Implemented evidence (MVP build)

Every row of `testing/acceptance-test-matrix.md` maps to automated tests. Files are under `apps/api/test` (integration `*.int.spec.ts`, end-to-end `*.e2e.spec.ts`), `apps/api/src` (unit `*.spec.ts`) and `apps/web/test` (Vitest + Testing Library).

| Matrix ID | Evidence |
|---|---|
| AUTH-01 | `foundation.int` (401 without session, HttpOnly/SameSite cookie, CSRF), `ops.int` sessions/CSRF/login-rate-limit/password hashing |
| TENANT-01 | `core.int` tenant isolation (cross-workspace ids, composite FK refusal), `foundation.int` (generic 404 + security event), `ops.int` (assignments, member removal) |
| ROLE-01 | `ops.int` 15 endpoints × 6 roles, `compliance.int` (check-in staff denied export/campaigns with audit), `domain.spec` matrix invariants |
| EVENT-01 | `core.int` events/time zones, `compliance.int` (invalid function leaves no partial data) |
| TIME-01 | `core.int` (Asia/Kolkata, America/New_York DST), `helpers.spec` (DST, nonexistent local time, quiet hours) |
| GUEST-01 | `core.int` CSV import (errors, duplicates, formula-like cells, idempotent commit, no consent granted, ~150 KB file), `import` unit tests in `domain.spec` |
| INV-01 | `core.int` (token limited to its function; hash-only storage; rotate/revoke) |
| RSVP-01 | `core.int`, `journey.e2e` steps 6-8, `ops.int` catering recalculation |
| RSVP-02 | `core.int` idempotent replay + key reuse; `guest-rsvp.test` (same key on retry) |
| RSVP-03 | `core.int` concurrent edits (one 200, one 409 with current answer); `guest-rsvp.test` conflict handling |
| RSVP-04 | `core.int` junk-token 404s + 429 budget; `compliance.int` logs contain no tokens/phones |
| RSVP-05 | `core.int` deadline/edit-lock; `compliance.int` organizer override after deadline is audited |
| MSG-01 | `messaging.int` consent evidence, attestation, confirmation + cost, spend cap, suppression |
| MSG-02 | `messaging.int` live gate fails closed; `compliance.int` no outbound HTTP(S)/remote sockets in a full send cycle |
| MSG-03 | `messaging.int` webhook signature, replay window, dedupe, out-of-order, opt-out; `domain.spec` status machine |
| MSG-04 | `messaging.int` transient retry/backoff, permanent failure + audited replay, timeout → unknown → reconcile |
| MSG-05 | `messaging.int` cancel (incl. queued), pause/resume, skip on answer/revocation/cancelled event |
| MSG-06 | `compliance.int` unknown/mismatched template refused; `messaging.int` invalid signature rejected |
| CHECKIN-01 | `ops.int` QR + manual, duplicate indication, 6-way race leaves one active record |
| CHECKIN-02 | `compliance.int` (caterer/read-only cannot void; owner void audited), `ops.int` staff scope |
| CATER-01 / 02 | `catering.spec` (arithmetic), `ops.int` (live recalculation, snapshots, caterer scope), `journey.e2e` step 9 |
| PRIV-01 | `messaging.int` + `journey.e2e` step 11 (opt-out suppresses and cancels pending), suppression survives guest deletion |
| PRIV-02 | `ops.int` export without tokens/bodies; deletion after confirmation + grace, retains opt-outs and audit log |
| REL-01 | `messaging.int` three concurrent workers send each message once; expired lease reclaimed |
| DB-01 | `compliance.int` migrations (empty DB, idempotent, checksum immutability, atomic rollback); every test run rebuilds the schema from the migrations |
| OBS-01 | `compliance.int` request id in header/body/logs, redaction; `helpers.spec` logger tests |

Contract drift: `openapi.int.spec` fails if `api/openapi.yaml` and the live router differ in either direction.
