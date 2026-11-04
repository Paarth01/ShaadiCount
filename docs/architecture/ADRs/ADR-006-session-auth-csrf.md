# ADR-006: Server-side sessions with CSRF protection

- **Status:** Accepted
- **Decision:** Email + password accounts (scrypt, per-user salt) with opaque server-side sessions. The cookie `sc_session` is `HttpOnly`, `SameSite=Lax`, `Secure` in production; only its SHA-256 is stored. A new session id is issued on every login. Every state-changing request needs an `X-CSRF-Token` equal to `HMAC(CSRF_SECRET, sessionId)` (returned by login/register/`/auth/me`, held in memory by the SPA) and an allowed `Origin` if one is sent. The web app proxies `/v1` so the browser only ever talks to one origin.
- **Public surfaces** (guest RSVP, provider webhooks) use no cookies: RSVP is authorised by the bearer token and protected by idempotency keys, optimistic versions and rate limits; webhooks by an HMAC signature over the raw body with a 5-minute replay window.
- **Not implemented:** email verification, password reset, MFA, SSO (they need an email provider/IdP decision; see open questions).
