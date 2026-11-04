# API Guide (Initial Contract)

Base path: `/v1`. JSON requests/responses. Authenticated endpoints use short-lived access credentials/session cookies and workspace membership authorization. Public RSVP routes use invitation tokens with strict rate limits and minimal response data.

## Conventions
- Cursor pagination for guest/message lists.
- RFC 3339 timestamps; event-local times paired with IANA timezone.
- Idempotency key required for import commit, RSVP submission/update, campaign scheduling, checkout creation and check-in where retry duplication is possible.
- Use `409 Conflict` for stale response version; `422` for business-rule validation; `429` for throttling; generic `404` for invalid public tokens.
- Never expose raw database identifiers when opaque public identifiers suffice.
- Every endpoint requires documented role, tenant scope, validation, rate limit and audit policy before production.


---

> **Implementation note:** the live contract is `api/openapi.yaml` (generated, drift-tested, served at `/docs`). It differs from the starter file by using workspace-scoped URLs; see [ADR-005](../architecture/ADRs/ADR-005-workspace-scoped-api-and-concealment.md). Error shape: `{ error: { code, message, requestId, details[] } }` plus extra fields for `VERSION_CONFLICT` (`current`), `DUPLICATE_GUEST` (`duplicates`) and `CONFIRMATION_MISMATCH` (`eligibleCount`, `estimatedCostPaise`).
