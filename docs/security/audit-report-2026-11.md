# ShaadiCount: Production Audit Report (2026-11)

> **Status of this document.** This is the audit of the code **as it was before the fixes**. It is kept unchanged as the
> record of what was found. For what was done about each finding, see [audit-fixes-2026-11.md](audit-fixes-2026-11.md);
> for what remains open, see [known-limitations.md](known-limitations.md).
>
> | Finding | Resolution |
> |---|---|
> | S1, S2, S3, S4, S5, S7, S8, S9, B1, B2, B3, B4, B5, B6, B7, B8, P1 (index), D1, D2, S12 (Dependabot) | Fixed, with regression tests |
> | S6 (RSVP token in URL path), S10 (CSP `unsafe-inline`), S11 (email enumeration), dashboard N+1 | Not changed, documented as known limitations |
> | Missing features (real messaging provider, password reset, email verification, MFA, CD/IaC, backups) | Not implemented |

## 0. How to read this report

**Verified by execution:** lint, typecheck, prettier, the repo's secret scan, `npm audit`, and the full test suite (all re-run
against a real PostgreSQL 16). The API was also run and probed over HTTP. Items marked **Confirmed** were reproduced;
**Probable** = strong code evidence, not reproduced; **Potential** = plausible risk; **Best practice** = hardening.

**Not done / limits:** `next build`, Docker builds, the browser UI and CI were not run. All API modules, all 4 migrations, all
infra files and the core web files were read in full, but many individual web page components, i18n files and test files were only
skimmed. Exact line numbers were not preserved, so locations are given as file + function; no line numbers were invented. The
per-endpoint matrix is summarised by route group (the full list is in `/v1/openapi.json`). No live messaging provider exists in
the repo, so none was tested. Not tested: spend-cap race, pool-error crash, query plans (attempts there were inconclusive and are
labelled below).

## 1. Executive Summary

| Area | Rating |
|---|---|
| Overall security | **Moderate Risk** (no critical findings; 2 Medium issues that should be fixed before launch) |
| Code quality | **Good** |
| Production readiness | **Not yet** (5.5/10) |

The codebase is unusually disciplined for an MVP: server-side authorization via a global guard, hashed session tokens, CSRF token +
Origin check, scrypt password hashing, parameterized SQL, HMAC-derived RSVP tokens stored only as hashes, append-only audit
triggers, idempotency keys, and a documented known-limitations list. **No SQL injection, no auth bypass, no secrets in the repo, no
XSS sinks** were found (`dangerouslySetInnerHTML`/`innerHTML`/`localStorage` absent).

**Most serious risks:** (1) the rate limiter collapses to one shared bucket behind the web proxy under the default config, which lets
one anonymous client block *every guest's RSVP and every login*; (2) function-scoped team members can read, unmask and modify guests of
functions they are not assigned to.

**Most important bugs:** invalid calendar dates return 500; concurrent guest/group creation returns 500; CSV export-to-import
round-trip fails for every phone number.

**Biggest gaps:** only a fake messaging provider exists (nothing is actually sent), no password reset / email verification / MFA found,
no deployment (CD/IaC) or backup story, CI failed on `npm audit`.

## 2. Project Overview

- **Backend:** NestJS 11 on Express 5, raw `pg` (no ORM), Zod validation, a separate worker process (message dispatcher, outbox relay,
  retention, deletions). Entry points: `apps/api/src/main.ts`, `worker.ts`.
- **Frontend:** Next.js (App Router), client-rendered, `/v1/*` proxied to the API via Next rewrites (same-origin, no CORS).
- **DB:** PostgreSQL, 4 SQL migrations at audit time, advisory-lock migrator, tenant column (`workspace_id`) on all tables, composite FKs.
- **Auth:** opaque random session cookie (hash stored), HttpOnly, SameSite=Lax, `Secure` in production, CSRF token = HMAC(sessionId).
- **Roles:** owner, organizer, planner, checkin_staff, caterer, readonly, with event/function assignment scoping.
- **Sensitive data:** guest names/phones/emails, consent records, RSVP responses, audit logs.
- **External services:** none live. Messaging uses a `fake` provider; a signed webhook endpoint exists. **No AI/LLM components.**
- **Data flow:** Browser to Next (`/v1` rewrite) to API to Postgres; Worker to Postgres to provider.

## 3. Security Findings

| ID | Severity | Finding | Location | Category | Status at audit |
|---|---|---|---|---|---|
| S1 | MEDIUM | Rate limiter shares one bucket behind proxy (default `TRUST_PROXY=0`) | `common/request.ts`, `common/rate-limit.service.ts`, `rsvp/rsvp.service.ts`, `auth/auth.service.ts`, `.env.example` | Security/Reliability | **Confirmed** |
| S2 | MEDIUM | Function-scoped assignment not enforced on event-level guest routes | `guests/guests.controller.ts`, `common/scope.service.ts` | Authorization | **Confirmed** |
| S3 | LOW | Targeted login lockout of a victim's email | `auth/auth.service.ts` | Auth | **Confirmed** |
| S4 | LOW | No rate limiting on authenticated routes; audit-log flooding | `auth/access.guard.ts`, `audit/audit.service.ts` | API | **Confirmed** (150 rows from 150 requests) |
| S5 | LOW | Weak password policy (10 chars, tiny blocklist; `aaaaaaaaaa` accepted) | `auth` schemas | Auth | **Confirmed** |
| S6 | LOW | RSVP bearer token travels in the URL *path* of API calls, so proxy/LB logs may capture it | `web/components/GuestRsvp.tsx`, `rsvp.controller.ts` | Privacy | Potential (infra-dependent; API logs do redact it) |
| S7 | LOW | `PSEUDONYM_SECRET` is dual-use; rotating it silently breaks opt-out suppression hashes | `guests/suppression.service.ts` | Compliance | Probable |
| S8 | LOW | Spend-cap check locks per campaign, not per workspace; concurrent campaigns could exceed the cap | `messaging/campaigns.service.ts` | Logic | Potential (not reproduced) |
| S9 | INFO | Swagger `/docs` and `/v1/openapi.json` public; no environment gating seen | `docs.ts` | Hardening | Confirmed (dev run) |
| S10 | INFO | CSP allows `script-src 'unsafe-inline'` (documented) | `web/next.config.mjs` | Hardening | Confirmed |
| S11 | INFO | Registration reveals existing emails (documented, accepted) | `auth.service.ts` | Privacy | Confirmed |
| S12 | INFO | CI actions pinned by tag, unpinned base images, no SAST/Dependabot/gitleaks | `.github/workflows`, Dockerfiles | Supply chain | Best practice |

### [MEDIUM] S1: Rate limiter collapses behind the proxy (P1)

**Problem:** The limiter is in-memory and keyed on `req.ip`. With `TRUST_PROXY=0` (the `.env.example` default) every browser request
arrives from the Next proxy's IP, so all users share the same buckets. `docker-compose.yml` sets `TRUST_PROXY=1`, and
`docs/devops/deployment.md` mentions it, but there is no startup warning and the correct hop count depends on topology (browser, LB,
Next, API needs 2, not 1).

**Evidence (reproduced):** after one client sent 10 garbage RSVP tokens, a *valid* link from a different client returned **429**; 11
failed logins against one email returned 429 to the victim's *correct* password and to an unrelated user; 80 legitimate guest page
loads from 80 distinct IPs produced **20 x 429** (global 60/min cap) with no attacker at all.

**Impact:** an anonymous attacker can block all RSVPs and logins with about 10 requests/min; a real invitation blast can trip it
unaided. CVSS-style 5.3 (A:L), CWE-770/CWE-307.

**Fix:** require `TRUST_PROXY` explicitly in production (fail startup if unset), document hop counts per topology, key on the verified
client IP, and move limiter state to Postgres/Redis (the in-memory limiter is also per-process, so it multiplies by replica count and
resets on restart). Add tests that run with *production* limits through the proxy path; the test env sets limits to 1000.

### [MEDIUM] S2: Function-scope bypass on guest routes (P1)

**Problem:** `scope.fn` is used on function routes, but event-level guest routes (list, get, update, consents, groups, import) only
call `scope.event`, which passes if the user has *any* assignment on the event.

**Reproduction (done):** owner creates an event with functions A and B and a guest invited only to B. A planner assigned only to A:
`GET functions/B*` returns 404 (correct), but `GET /events/:id/guests` lists the B-only guest with their B invitation,
`GET guests/:id?reveal=true` returns the **full phone and email**, `POST consents` returns 201, and `PATCH guests/:id` returns 200
(renamed it).

**Impact:** violates the documented "scoped roles see only assigned functions" guarantee; exposes unmasked contacts and allows
tampering. CWE-863/CWE-639; rated Medium because the actor is an invited same-tenant member.

**Fix:** decide the policy. Either restrict guest routes to users with event-wide assignment, or filter guests/invitations to the
user's visible functions and block write/reveal for guests outside them. Add authorization tests for scoped planners.

### [LOW] S3, S4, S5, S7

- **S3:** 10 failed attempts/min per email lock out that email (and per-IP bucket). Use an email+IP key with backoff instead.
- **S4:** authenticated routes have no rate limit; each request to a random workspace id writes an audit row, so storage grows
  unbounded and workspace creation is unlimited. Add per-user limits and do not audit-log every denial (aggregate or sample).
- **S5:** raise the policy (breached-password check, e.g. zxcvbn/HIBP k-anonymity) rather than a 10-char minimum.
- **S7:** use a separate secret (or a versioned key id) for suppression hashing, and document that it must never be rotated without
  re-hashing.

## 4. Bug Findings

| ID | Severity | Bug | Location | Impact | Status at audit |
|---|---|---|---|---|---|
| B1 | MEDIUM | Invalid calendar dates (`2026-02-31`, `2026-13-45`) pass Zod and cause 500 | events schemas | Unhandled DB error | **Confirmed** |
| B2 | MEDIUM | Concurrent creates with the same new group label: 9/60 returned 500 (`guest_groups_label_uq`) | `guests.service.ts` `groupInTx`, import commit, `createGroup` | Intermittent failures during imports/bulk adds | **Confirmed** |
| B3 | MEDIUM | CSV export prefixes phones with `'` (formula guard) so `'+91...` fails re-import; 2/2 rows rejected | `common/csv.ts` `csvCell`, `reporting.service.ts` | Export to import round-trip broken | **Confirmed** |
| B4 | LOW | No global 401 handling in the web app; expired sessions show error banners instead of redirecting | `web/lib/api.ts`, `components/ui.tsx` | UX | Confirmed (code) |
| B5 | LOW | QR check-in result shows no guest name; a scanned code whose RSVP is no longer Yes cannot be override-confirmed in scan mode | check-in page/service | UX/ops | Confirmed (code) |
| B6 | LOW | If a provider adapter *throws*, the message loops via lease expiry with no dead-letter | `dispatcher.service.ts` | Poison message | Potential |
| B7 | LOW | `setStatus` accepts `cancelled` as a source state, so a late `failed` can overwrite `cancelled` | `dispatcher.service.ts` | Misreporting | Potential |
| B8 | MEDIUM | No `pool.on('error')` handler and no `connectionTimeoutMillis`; idle-connection errors can crash the process and pool exhaustion hangs requests | `common/db.service.ts` | Reliability | **Probable** (absence confirmed by grep; crash experiment inconclusive) |

## 5. Feature Audit

| Feature | Status | Evidence | Missing/Problem |
|---|---|---|---|
| Register/login/logout/session | Complete | Probed; logout invalidates cookie | No password reset, email verification, MFA or change-password found in the auth controller |
| Workspaces, team, roles, assignments | Partial | Roles enforced; tests pass | Scope bypass (S2) |
| Events and functions | Partial | CRUD works | Date validation bug (B1) |
| Guests, groups, CSV import | Partial | Import preview/commit tested | Race (B2); export round-trip (B3) |
| Invitations and public RSVP | Complete | Token flow, versioning, revoke 410 | Rate-limit coupling (S1) |
| Check-in (QR + search) | Complete | 12 e2e tests pass | UX gaps (B5) |
| Catering / reports / exports | Complete | Unit tests | Export bug B3 |
| Messaging campaigns | Mock/Placeholder | Fake provider only | No real provider; inbound STOP for live providers unmatched unless tied to a message |
| Privacy export/deletion | Complete | Compliance tests pass | Rotation caveat S7 |
| Audit log | Complete | Append-only triggers | Flooding (S4) |
| CD / infra / backups | Missing | Only CI + local compose | See section 13 |

## 6. Dependency Audit

| Dependency | Version | Risk | Vulnerability | Action |
|---|---|---|---|---|
| `postcss` (bundled under `next`) | 8.4.31 | Medium | `npm audit` reported 2 findings, documented as accepted in the README | Use a patched PostCSS; usage is build-time CSS, so runtime exploitability looked limited (not verified) |
| `js-yaml` | direct dep `^5.5.0` | Low | None reported; **appeared unused** in `apps/api/src`, and `npm ls` showed the `@nestjs/swagger` override as *invalid* | Remove the dependency/override or fix it |

**Important:** `npm audit --omit=dev --audit-level=high` exited **1**, and CI's `quality` job runs exactly that, so the pipeline as
shipped failed (and `build-and-smoke` depends on it). The README's "accepted risk" was inconsistent with the CI gate. Advisory details
were not verified beyond the audit output, and no package was called vulnerable merely for being old.

## 7. API Security Matrix (by route group)

| Endpoint group | Auth | Authorization | Validation | Rate limit | Risk |
|---|---|---|---|---|---|
| `/v1/auth/register`, `/login` | Public | n/a | Zod | IP + email, in-memory | S1, S3, S5, S11 |
| `/v1/auth/logout`, `/me` | Session + CSRF | session owner | Zod | none | Low |
| `/v1/public/rsvp/:token` (GET/POST) | Bearer token (HMAC) | token scope | Zod + idempotency | IP + token | S1, S6 |
| `/v1/webhooks/messaging/:provider` | HMAC signature + timestamp window + dedupe | n/a | raw-body signature | IP | Low |
| `/v1/workspaces/:id/members*` | Session | `members:*` (owner) | Zod | none | Low |
| `/v1/workspaces/:id/events/:id/guests*` | Session | role **+ event-level scope only** | Zod | none | **S2** |
| `/v1/.../functions/:id/*` (invitations, check-in, dashboards) | Session | role + function scope | Zod | none | Low |
| Exports / privacy / audit | Session | role perms (owner/organizer) | Zod | none | Low |
| `/docs`, `/v1/openapi.json`, `/v1/health*` | Public | n/a | n/a | none | S9 |

CSRF (token + Origin) was verified: missing token, forged token and foreign Origin all return 403. No CORS is enabled (same-origin
proxy), which is correct for this design.

## 8. Authentication and Authorization Assessment

Sessions are 256-bit random tokens stored as hashes, with idle and absolute expiry, HttpOnly + SameSite=Lax cookies, and verified
server-side logout. Passwords use scrypt (N=32768) with a dummy hash for unknown users (no timing oracle; unknown-user and
wrong-password messages are identical). Authorization is a global guard resolving workspace membership per request, with
cross-workspace access returning 404 and audited. **Weaknesses:** S2 (scope), S3/S5, absence of password reset/MFA/email
verification, and no session list/revoke UI.

## 9. Database Assessment

Strong: tenant columns, composite FKs, CHECK constraints, partial unique indexes, append-only audit/history triggers, idempotency
table, advisory-locked migrations, all queries read were parameterized (no concatenated user input found). **Issues:** unhandled
unique-violation paths (B2), no pool error handler/timeouts (B8), unbounded growth of `audit_logs`, `outbox_events`,
`provider_webhook_events`, `message_attempts` (the retention job did not prune them), `LIKE` searches do not escape `%`/`_`
(harmless within a tenant, but unindexable), and TLS to Postgres depends on `sslmode` in the URL (not documented as required).
**Probable performance issue:** the per-message rate-limit query on `message_attempts(workspace_id, started_at)` had no supporting
index (the only index was the unique `(scheduled_message_id, attempt_number)`); the EXPLAIN attempt did not complete, so this was
**unmeasured**.

## 10. AI/LLM Security Assessment

Not applicable: no AI/LLM, RAG or agent components exist in the project.

## 11. Performance Assessment

Unmeasured under load. Likely hotspots: (Medium) the `message_attempts` query without an index; (Low) dashboard N+1 (per-function
dashboard queries per event), sequential 500-row invitation inserts, correlated subqueries in guest lists, the dispatcher doing about
8 queries per message (fine at MVP volume), scrypt (32 MB, threadpool-bound) on login/register bursts.

## 12. Testing Assessment

- **Found/executed/passed at audit time:** API unit 53/53, API integration 82/82 (real Postgres), API e2e 12/12, web unit 30/30 (one
  React `act()` warning). Lint, `tsc`, prettier and secret scan: clean.
- **Meaningful:** integration tests cover tenancy, idempotency, RSVP versioning, privacy/deletion, messaging.
- **Gaps:** rate limiting at production values/through the proxy; scoped-role authorization (would have caught S2);
  concurrency/race tests; invalid-date inputs; CSV round-trip; webhook signature negatives at scale; browser/UI e2e; coverage not
  measured; no load tests.

## 13. Production Readiness: 5.5 / 10

Blocking at audit time: S1, S2, B1 to B3, B8; red CI (`npm audit`); no real messaging provider; no TLS/CD/IaC, backup/restore,
monitoring/alerting or secret-rotation runbook (only guidance in `deployment.md`); single in-memory limiter blocks horizontal
scaling; no password reset/MFA.

## 14. Prioritized Fix Plan

**P0, now:** none (no critical findings).

**P1, before production:** S1 (rate limiting/proxy), S2 (scope), B1, B2, B3, B8, fix the CI audit gate, choose and integrate a real
messaging provider.

**P2, soon:** S3/S4/S5/S7/S8, B4 to B7, retention for growing tables, `message_attempts` index, password reset + email verification,
restrict `/docs` in production.

**P3:** pin base images/actions, add SAST/Dependabot/gitleaks, tighten CSP (nonces), dashboard N+1, remove unused `js-yaml`.

## 15. Recommended Roadmap

1. Fix S1 and S2 with tests. 2. Fix B1 to B3 and B8. 3. Resolve the dependency/CI gate. 4. Add password reset, email verification,
optional MFA. 5. Add missing tests (authz, races, rate limits, CSV). 6. Index/retention/performance pass with measurements. 7. Real
provider + inbound STOP handling. 8. Production deployment: TLS, managed Postgres with backups, monitoring, secret rotation.

## 16. Final Verdict (at audit time)

| Metric | Score |
|---|---|
| Security | 6.5 / 10 |
| Code Quality | 8 / 10 |
| Reliability | 6 / 10 |
| Performance | 6.5 / 10 (unmeasured) |
| Feature Completeness | 7 / 10 (for an MVP) |
| Production Readiness | 5.5 / 10 |

The foundations are strong and the project clearly designs for security. The remaining problems were mostly **operational and
consistency gaps** (one environment-dependent rate limiter, one inconsistently applied scope check, a few unhandled edge cases)
rather than deep flaws. Fix the P1 list and add the missing tests and this becomes a credible production candidate.
