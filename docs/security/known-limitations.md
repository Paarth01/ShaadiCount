# Known security limitations and accepted risks

Honest list of what is **not** done or not verified in this MVP build. None of these is hidden in code; each needs an owner before production use.

## Not implemented
- **Email verification, password reset, MFA/SSO.** They need an email provider / IdP decision. Until then a lost password cannot be recovered and accounts are unverified. Registering with an existing email returns `409 EMAIL_IN_USE` (account enumeration is possible on that endpoint; login itself is uniform).
- **Row-level security** in PostgreSQL. Tenant isolation relies on application checks plus composite foreign keys (both tested). RLS is recommended defence in depth.
- **Shared rate limiting.** The limiter is in-process memory (login, register, public RSVP, webhook). It is correct for one API instance; use a shared store before scaling out.
- **Fine-grained per-endpoint rate limits on authenticated routes.** A per-user ceiling (`RATE_LIMIT_USER_PER_MIN`, default 600) and a 100 KB body cap (1 MB for CSV preview) apply, but individual expensive endpoints (exports, imports) have no separate limit.
- **Real WhatsApp/SMS/email delivery.** Only the sandbox provider exists. `LiveProviderStub` refuses every send. See `docs/messaging/provider-integration.md`.
- **Offline check-in.** Check-in needs connectivity; a failed tap shows "not recorded" and is retried with the same idempotency key.

## Accepted risks
- **PostCSS advisories via Next.js: resolved.** `postcss` is a direct web dependency at `^8.5.32` and an npm `overrides` entry forces Next to use it; `npm audit --omit=dev` reports 0 vulnerabilities and `next build` passes. Re-check when upgrading Next.
- **Content-Security-Policy allows inline scripts** (`script-src 'self' 'unsafe-inline'`) because Next's bootstrap scripts need either that or a per-request nonce, and the nonce variant could not be verified in a real browser here. Other directives are strict (`frame-ancestors 'none'`, `default-src 'self'`, `connect-src 'self'`, `object-src 'none'`). React escapes all rendered data and there is no `dangerouslySetInnerHTML`.
- **Dependency pins.** The registry's latest majors (Nest 12, TypeScript 7, ESLint 10) are newer than what could be validated; the repository pins Nest 11, TypeScript 5.9, ESLint 9, Next 15, zod 4. `multer` is pinned to a patched version through an npm `override`. The former `js-yaml` override/dependency was removed (unused by the API source); `npm audit` reports no js-yaml advisory.

## Verified in this build (see PROGRESS.md for counts)
Cross-tenant access, CSRF/origin checks, session revocation, role matrix, deadline/idempotency/optimistic-concurrency rules, token hashing and rotation, webhook signature + replay + dedupe, consent/suppression gating, audit append-only triggers, CSV-injection escaping, log redaction (tokens, phones, message text), absence of outbound network calls in fake mode, secret scanning.

## Not verified here
Real-browser behaviour (no browser was available), screen-reader and automated accessibility audits, camera QR scanning, load/performance, Docker image builds and the GitHub Actions workflow (no Docker/CI runner in the sandbox), penetration testing, legal/DPDP review, native-speaker proofreading of the Hindi copy.

## Remaining after the 2026-11 audit fixes
- **RSVP bearer token appears in the URL path of the public API calls** (`/v1/public/rsvp/:token`). The API redacts it from its own logs, but reverse-proxy/CDN access logs may record it; configure those to drop or redact that path, or move the token to a header in a future API version.
- **Function-scoped team members have no event-level guest access by design.** Guests, groups, consents and imports require an assignment to the whole event (`function_id` NULL); function-only assignments use the function-level routes (invitations, dashboard, check-in).
- **No password reset, email verification or MFA** (see above), and no real messaging provider.
