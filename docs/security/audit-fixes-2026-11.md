# Production audit fixes (2026-11)

Each item below was reproduced against the original code before it was fixed and re-verified afterwards (regression tests are in
`apps/api/test/audit-fixes.int.spec.ts`, `apps/api/src/domain.spec.ts`, `apps/web/test/api-session.test.ts`).

| ID | Issue | Fix |
|----|-------|-----|
| S1 | Rate limiter shared one bucket behind the web proxy (default `TRUST_PROXY=0`): one client could block every guest's RSVP and every login | `TRUST_PROXY` is mandatory in production (empty counts as unset); one-time `trust_proxy_misconfigured` warning; public per-IP default raised 60 to 120 |
| S2 | Function-scoped planners could list, unmask, edit and record consent for guests of other functions | New `ScopeService.eventWide()`; all event-level guest routes require an event-wide assignment |
| S3 | Anyone could lock a victim out by hammering their email | Login bucket is per email + client IP; a high email-only ceiling (`RATE_LIMIT_LOGIN_EMAIL_PER_MIN`) still caps distributed guessing |
| S4 | No limits on authenticated routes; denied-access probing flooded the audit log | Per-user ceiling (`RATE_LIMIT_USER_PER_MIN`, default 600); denied-access audit rows throttled to 20/min/user |
| S5 | Weak passwords accepted (`aaaaaaaaaa`) | `auth/password-policy.ts`: distinct characters, repetition, sequences, common words, email name |
| S7 | Rotating `PSEUDONYM_SECRET` silently broke opt-out suppression | Optional dedicated `SUPPRESSION_HASH_SECRET` (falls back to the old secret, so existing hashes stay valid) |
| S8 | Concurrent campaigns could exceed the workspace spend cap | Per-workspace advisory lock around the cap check |
| S9 | `/docs` and `/v1/openapi.json` public in all environments | `DOCS_ENABLED` (default on outside production, off in production) |
| S12 | No automated dependency/CI-action/image updates | `.github/dependabot.yml` |
| B1 | Impossible dates (`2026-02-31`) returned 500 | Real calendar-date validation |
| B2 | Concurrent creation of the same group label returned 500 | `INSERT ... ON CONFLICT DO NOTHING` + re-read |
| B3 | Exported CSV phone numbers (`'+91...`) could not be re-imported | Import removes the formula guard that export adds |
| B4 | Expired session left the app showing error banners | Global 401 handling redirects to `/login?expired=1` (validated `next` path, no open redirect) |
| B5 | QR check-in showed no guest name and could not be confirmed manually | Response includes `guestName`/`partySize`; the 409 error carries what the UI needs to confirm |
| B6 | A throwing provider adapter looped forever | Per-message exception handling: backoff, then dead-letter at `MESSAGE_MAX_ATTEMPTS` |
| B7 | A late failure could overwrite `cancelled` | `cancelled` may only move to `submitted`/`unknown` (accepted after cancel) |
| B8 | No pool error handler or timeouts (idle-connection error could crash the process; exhausted pool hung) | `pool.on('error')`, connection/idle/idle-in-transaction timeouts, broken clients destroyed |
| P1 | Dispatcher rate-limit query scanned all of `message_attempts` | Migration `0005` indexes; retention now prunes published outbox rows, processed webhook events and old attempts |
| D1 | CI failed on `npm audit --audit-level=high` (PostCSS under Next) | `postcss ^8.5.32` direct dependency + override; `npm audit` reports 0 vulnerabilities; `next build` passes |
| D2 | Unused `js-yaml` dependency and an invalid override | Removed |

## Deliberately not changed
See `known-limitations.md` ("Remaining after the 2026-11 audit fixes"): RSVP token in the URL path, CSP `unsafe-inline`,
no password reset / email verification / MFA, no real messaging provider, in-memory (single-instance) rate limiter, no CD/IaC/backups.
