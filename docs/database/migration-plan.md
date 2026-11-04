# Database Migration Plan and Hardening Checklist

`db/001_initial_schema.sql` is an illustrative starting migration, not production-ready. Do not apply it to production unchanged.

## Required schema reconciliation
Before implementing feature endpoints:
- Reconcile every table/field with `schema-reference.md`, ERD, API schemas and the implementation contract.
- Add composite tenant-safe foreign keys so a row with `workspace_id = A` cannot reference a parent owned by workspace B. Examples include `(workspace_id, event_id)` and `(workspace_id, guest_id)` composite constraints where the parent has a matching unique key.
- Ensure event functions reference events in the same workspace; invitations reference guest and function in the same workspace; responses/history/messages/check-ins/catering estimates reference their invitation/function in the same workspace.
- Add `communication_preferences`, `communication_consents`, import jobs/rows, export jobs, idempotency records, subscription/billing tables only if required by the approved scope. Billing tables are not required for MVP behavior; avoid implementing payment processing prematurely.
- Define provider connection/config storage without storing credentials in plaintext. Prefer a secret manager and store only references/metadata in the database.
- Add invitation token hash generation/rotation/revocation and expiry semantics. Tokens must have adequate entropy; do not use predictable IDs as bearer secrets.
- Define `maybe` count semantics, party-size enforcement and organizer override audit fields.
- Make check-in uniqueness include function scope, not only invitation scope, and verify the invitation belongs to that function.
- Add status CHECK constraints or reference tables for every status column; avoid free-form status values.
- Add foreign keys and deletion rules deliberately. Avoid cascading deletes that erase consent/opt-out or audit evidence before retention rules are approved.
- Add indexes from actual access patterns and validate with `EXPLAIN` for key queries.

## Migration discipline
1. Use ordered, immutable migration files (`001`, `002`, ...); never silently edit an applied migration.
2. CI must create an empty database, apply every migration in order, and run schema checks.
3. Use forward-only migrations in production. Destructive changes require a staged expand/migrate/contract plan and backup/restore test.
4. Every migration needs a rollback/mitigation note, expected lock/downtime risk, and data backfill behavior.
5. Seed only synthetic development data; make seeding repeatable and safe.
6. Use transactions where supported. For large tables, document concurrent index or backfill strategies.
7. Test restore into a clean environment before production launch.

## Required automated tests
- Cross-workspace foreign-key mismatch is rejected.
- Invitation uniqueness per function/guest is enforced.
- Duplicate webhook and idempotency keys do not duplicate side effects.
- RSVP version conflict returns a conflict and preserves history.
- Duplicate active check-in is rejected; a voided check-in can be corrected only through authorized flow.
- Opt-out/suppression evidence is not deleted by ordinary guest deletion.
- RSVP token plaintext is never stored or logged.
