# Risk Register

| ID | Risk | Likelihood/impact | Mitigation | Owner |
|---|---|---|---|---|
| R-01 | Provider onboarding/template rules delay launch | High/High | Validate in Phase 0; build provider adapter only after test account succeeds | Messaging lead |
| R-02 | SMS legal/telecom classification misunderstood | Medium/High | Counsel + provider review; no launch until confirmed | Legal/product |
| R-03 | Guest list uploaded without appropriate authority | Medium/High | Organizer attestation, notice, purpose limitation and deletion workflow | Privacy owner |
| R-04 | Duplicate or lost reminders | Medium/High | Outbox, idempotency, eligibility recheck and reconciliation | Backend lead |
| R-05 | Guest token forwarded to unintended recipient | Medium/Medium | Token revocation, minimal page disclosure, party cap and audit | Security lead |
| R-06 | Incorrect headcount due to group semantics | High/High | Explicit household/person/party-size definitions and UX testing | Product lead |
| R-07 | Peak-season queue/database overload | Medium/High | Load tests, per-tenant quotas, backpressure and staged scaling | Platform lead |
| R-08 | Pricing does not cover message costs/support | Medium/High | Pilot unit economics, usage visibility and caps | Business owner |
| R-09 | Provider callback is delayed or absent | High/Medium | `unknown` state, reconciliation and no false delivery claim | Messaging lead |
| R-10 | Catering estimates interpreted as guarantees | Medium/High | Display assumptions, ranges, timestamps and disclaimer | Product lead |

| R-11 | Basic features are already offered by direct competitors or free tools | High/High | Treat features as table stakes; validate planner workflow, paid intent and measurable outcomes before expanding build | Product/business |
| R-12 | Product claims imply reduced food waste without evidence | Medium/High | Separate headcount accuracy from prepared/served/leftover measurements; review marketing claims | Product/research |
| R-13 | WhatsApp policy, onboarding, template rules or pricing changes | High/High | Official policy/provider verification gate; versioned assumptions and pricing check before launch | Messaging lead |
| R-14 | Organizer upload is mistaken for guest opt-in | Medium/High | Do not infer consent from phone number; record authorization context, suppress opt-outs, counsel review | Privacy owner |
| R-15 | Guests do not respond or response arrives after caterer cutoff | High/High | Pilot response timing; show uncertainty; do not rely on RSVPs as attendance guarantee | Product lead |
| R-16 | One-time seasonal demand produces weak retention | Medium/High | Test planner repeat use and annual retention; avoid assuming monthly subscription fit | Business owner |
| R-17 | Caterer report exposes excessive guest data | Medium/High | Aggregate-first export, scoped permissions, explicit export authorization and audit log | Security/product |


---

## Added during implementation

| ID | Risk | Mitigation / status |
|---|---|---|
| IMPL-01 | `RSVP_TOKEN_SECRET` loss or rotation invalidates all links and QR codes | Documented rotation procedure; links re-issuable from the app |
| IMPL-02 | In-memory rate limiter is per instance | Single-instance guidance; shared store before scale-out |
| IMPL-03 | No email verification / password reset | Accepted for pilot; build with an email provider |
| IMPL-04 | No real browser E2E, no automated a11y scan, Docker/CI not executed in the build sandbox | Run the CI workflow and add Playwright + axe before launch |
| IMPL-05 | PostCSS advisories via Next 15 (build-time only) | Accepted; upgrade to Next 16 and re-test |
| IMPL-06 | zod 4 changed `.default()`/`.partial()` semantics | Update schemas are default-free by construction and covered by PATCH regression tests |
| IMPL-07 | Placeholder message costs and unverified Hindi copy | Replace before live messaging |
