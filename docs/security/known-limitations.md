# Known security limitations and accepted risks

Honest list of what is **not** done or not verified in this MVP build. None of these is hidden in code; each needs an owner before production use.

## Not implemented
- **Email verification, password reset, MFA/SSO.** They need an email provider / IdP decision. Until then a lost password cannot be recovered and accounts are unverified. Registering with an existing email returns `409 EMAIL_IN_USE` (account enumeration is possible on that endpoint; login itself is uniform).
- **Row-level security** in PostgreSQL. Tenant isolation relies on application checks plus composite foreign keys (both tested). RLS is recommended defence in depth.
- **Shared rate limiting.** The limiter is in-process memory (login, register, public RSVP, webhook). It is correct for one API instance; use a shared store before scaling out.
- **Per-user rate limits on authenticated routes.** Only a 100 KB default body cap (1 MB for CSV preview) bounds them.
- **Real WhatsApp/SMS/email delivery.** Only the sandbox provider exists. `LiveProviderStub` refuses every send. See `docs/messaging/provider-integration.md`.
- **Offline check-in.** Check-in needs connectivity; a failed tap shows "not recorded" and is retried with the same idempotency key.

## Accepted risks
- **PostCSS advisories via Next.js (`npm audit`: 1 high, 1 moderate).** All four advisories concern processing *attacker-controlled* CSS (unescaped `</style>` in stringified output, `sourceMappingURL` file reads). PostCSS only runs at build time on first-party CSS here; no user CSS is parsed at runtime. The fix requires the Next.js 16 major upgrade, which was not validated; schedule it and re-run the full suite.
- **Content-Security-Policy allows inline scripts** (`script-src 'self' 'unsafe-inline'`) because Next's bootstrap scripts need either that or a per-request nonce, and the nonce variant could not be verified in a real browser here. Other directives are strict (`frame-ancestors 'none'`, `default-src 'self'`, `connect-src 'self'`, `object-src 'none'`). React escapes all rendered data and there is no `dangerouslySetInnerHTML`.
- **Dependency pins.** The registry's latest majors (Nest 12, TypeScript 7, ESLint 10) are newer than what could be validated; the repository pins Nest 11, TypeScript 5.9, ESLint 9, Next 15, zod 4. `multer` and `js-yaml` are pinned to patched versions through npm `overrides`/direct dependencies because upstream packages pin vulnerable ones.

## Verified in this build (see PROGRESS.md for counts)
Cross-tenant access, CSRF/origin checks, session revocation, role matrix, deadline/idempotency/optimistic-concurrency rules, token hashing and rotation, webhook signature + replay + dedupe, consent/suppression gating, audit append-only triggers, CSV-injection escaping, log redaction (tokens, phones, message text), absence of outbound network calls in fake mode, secret scanning.

## Not verified here
Real-browser behaviour (no browser was available), screen-reader and automated accessibility audits, camera QR scanning, load/performance, Docker image builds and the GitHub Actions workflow (no Docker/CI runner in the sandbox), penetration testing, legal/DPDP review, native-speaker proofreading of the Hindi copy.
