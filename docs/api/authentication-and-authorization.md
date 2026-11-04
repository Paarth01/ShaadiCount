# Authentication, Authorization and API Error Contract

This document supplements `API_GUIDE.md` and `api/openapi.yaml`. The OpenAPI file is an incomplete starter until all endpoints and schemas below are represented.

## Authentication
- Organizer routes require an authenticated user and active workspace membership.
- Choose either secure server-managed sessions (recommended for a browser-first MVP) or a documented access/refresh-token design. Do not mix strategies casually.
- For cookie sessions: `HttpOnly`, `Secure` in production, appropriate `SameSite`, CSRF protection on state-changing requests, session rotation after login/privilege change, and logout/revocation.
- If bearer tokens are used: short access-token lifetime, refresh-token rotation and revocation, issuer/audience validation, key rotation plan, and no tokens in localStorage where avoidable.
- Public RSVP endpoints use a random high-entropy invitation token. Store a cryptographic hash; compare safely; support expiry and revocation; rate-limit requests; avoid token leakage in analytics/referrer/logs. Prefer URL fragment or one-time exchange if compatible with the UX/security design.
- Provider webhooks must verify the provider signature against the raw request body before processing.

## Authorization
- Every workspace-owned endpoint resolves the workspace from the authorized route/resource and verifies membership/role on the server.
- Never trust a client-provided `workspaceId`, `eventId`, or role without verifying the full ownership chain.
- Public token access is limited to the invitation's allowed function and fields; do not reveal guest lists, phone numbers, organizer notes or other household members.
- `checkin_staff` may only search/check in guests for assigned functions; `caterer` receives approved aggregate reports only; `readonly` cannot send messages or export contact details by default.
- Exports and bulk messaging require explicit permissions and audit records.

## Standard error envelope
Use a stable JSON error shape such as:
```json
{
  "error": {
    "code": "RSVP_VERSION_CONFLICT",
    "message": "This response was updated elsewhere. Refresh and try again.",
    "requestId": "opaque-request-id",
    "details": []
  }
}
```
Never include stack traces, SQL, provider secrets or sensitive personal data in public errors.

## HTTP semantics
- `400`: malformed request or invalid syntax.
- `401`: missing/invalid authentication.
- `403`: authenticated but not permitted (use generic `404` for public invalid/expired token cases where enumeration is a risk).
- `404`: resource not found or intentionally concealed.
- `409`: stale version, duplicate state transition, or idempotency-key payload mismatch.
- `422`: syntactically valid request violates business rules.
- `429`: rate limit exceeded; include a safe retry hint when appropriate.
- `500`: generic unexpected error with request ID only.

## Idempotency
For each endpoint that creates an external side effect or is commonly retried, scope idempotency by workspace, actor, operation and key. Store a request fingerprint and response result. Reusing a key with a different payload returns `409`. Define retention and cleanup. Public RSVP submission must be retry-safe without allowing the same request to create duplicate history entries.

## API completeness gate
Before calling the API stable, OpenAPI must document each endpoint's authentication, role, workspace scope, parameters, request schema, response schema, status/error responses, idempotency behavior, rate limit, and whether it exposes personal data. Add generated-client or schema-drift checks in CI where practical.
