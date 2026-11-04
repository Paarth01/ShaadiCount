# Specification package audit (start of implementation)

The ZIP contained product, architecture, database, API, security, messaging, privacy, UX, testing and DevOps documents, a starter SQL schema, a starter OpenAPI file and diagrams. All files were read. Conflicts and gaps were resolved using the implementation contract and decisions baseline, then recorded here.

## Conflicts and how they were resolved

| # | Finding | Resolution |
|---|---------|------------|
| 1 | ADR-003 mandates Redis + BullMQ; the implementation contract, README and decisions baseline say Postgres-first. | Postgres outbox + worker ([ADR-007](../architecture/ADRs/ADR-007-postgres-worker-no-redis-mvp.md)). ADR-003 annotated as superseded for the MVP. |
| 2 | Starter SQL allowed a `co_organizer` role the contract does not list. | Dropped. The six contract roles are enforced by a CHECK constraint. |
| 3 | Starter OpenAPI took `workspaceId` in bodies, contradicting the authorization doc. | Workspace-scoped URLs ([ADR-005](../architecture/ADRs/ADR-005-workspace-scoped-api-and-concealment.md)). `api/openapi.yaml` was regenerated for the real API (80 operations) and a test fails on drift. |
| 4 | "Store only the token hash" vs a worker that must put the link in later reminders. | HMAC-derived tokens ([ADR-004](../architecture/ADRs/ADR-004-derived-invitation-tokens.md)). |
| 5 | Starter foreign keys were not tenant-safe; `guests`/`guest_groups` were workspace-level while the ERD placed them under events. | Composite `(workspace_id, ...)` foreign keys everywhere; guests and groups are event-scoped. |
| 6 | Starter SQL had no explicit invitation to check-in/function integrity. | `check_ins` and `scheduled_messages` reference invitations through `(workspace_id, event_function_id, id)`, so a check-in or message can never point at an invitation of another function. |
| 7 | Backlog implies consent/opt-out handling but the schema had no consent evidence or suppression model. | Added `communication_consents` (evidence required) and `communication_suppressions` (hashed contact, never linked to guests, survives erasure). |
| 8 | Security docs ask for audit tamper resistance without a mechanism. | Append-only triggers on `audit_logs` and `rsvp_response_history` (purge only inside an explicit workspace-deletion transaction, and never for audit logs). |

## Gaps filled by documented assumptions

See `docs/project/open-questions.md` section "Resolved during implementation". Highlights: the catering formula, the 21:00-09:00 default quiet hours, 7-day export/import retention, 7-day deletion grace period, email+password identity, placeholder message-cost rates, and the exact fields of the guest CSV.

## Missing or unverifiable items

No provider credentials, approved WhatsApp templates, DPIA/legal review outcome, hosting target, domain, or pricing were supplied. Nothing in the repository claims compliance; see `docs/privacy/india-compliance-review.md` (still an open legal task).
