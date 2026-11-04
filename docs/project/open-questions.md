# Open Questions and Decision Owners

Do not block local development on every question. Use the decisions baseline and safe stubs; escalate the following before the affected production feature is enabled.

| Question | Owner | Safe interim behavior | Needed by |
|---|---|---|---|
| Final first customer segment and willingness to pay | Product | Planner-first pilot hypothesis | Before broad GTM |
| Guest identity and household editing rules | Product/Data | One invitation per guest per function; group is organizational only | Before pilot onboarding |
| RSVP behavior for `maybe`, party-size limits and deadline overrides | Product | Rules in implementation contract; override requires audit reason | Before pilot |
| Re-entry, walk-ins and check-in correction | Product/Operations | One active check-in per invitation/function; audited correction | Before check-in pilot |
| WhatsApp account model/provider and business verification | Product/Legal/Messaging | Fake provider only | Before live WhatsApp |
| Consent/opt-in evidence and template language | Legal/Messaging | No live send without explicit eligible evidence and approved template | Before live messaging |
| SMS classification, sender registration and templates | Indian counsel/provider | SMS adapter disabled | Before live SMS |
| Exact retention and deletion periods | Privacy/Legal | Minimize collection; short-lived import/export artifacts; do not claim final compliance | Before production |
| Authentication/session approach | Engineering/Security | Choose and document one secure approach before auth implementation | Phase 1 |
| Hosting provider, data region and backup obligations | Platform/Legal | Local/dev only | Before production |
| Support access and break-glass controls | Security/Operations | No unrestricted production support access | Before production |
| Pilot volume, concurrency and SLO targets | Engineering | Modest pilot; measure and test load | Before scaling |
| Child data | Privacy/Product | Collect only aggregate child counts where possible; avoid names/DOB | Before pilot |
| Payment gateway and billing | Product/Finance | Out of MVP | Before paid in-product billing |

Record each decision with owner, date, evidence and affected docs. Provider policies, rates and Indian law may change; verify current official sources at launch. This document is not legal advice.


---

## Resolved during implementation (assumptions to confirm)

| Topic | Decision taken | Why / how to change |
|---|---|---|
| Identity provider | Email + password, server sessions, no verification/reset | Needs an email provider decision; see known limitations |
| Collaborator onboarding | Owner adds an *already registered* user by email | No invitation emails in the MVP |
| Guest ownership | Guests belong to one event (no cross-event contact book) | Matches the ERD; avoids cross-event PII sharing |
| RSVP links | One token per guest per function; link in the URL fragment `/r#token` | Satisfies INV-01 and keeps tokens out of logs |
| Maybe handling | Counts are provisional and may be 0; catering weights them (default 50%) | Documented in the catering tab |
| Catering formula | `ceil((confirmed + maybe×w + pending×p) × (1+buffer))`, total rounded up to a multiple; pending treated as adults | `apps/api/src/reporting/catering.ts`; weights/buffer/rounding/prices are editable per function |
| Walk-ins | Not supported: an invitation is required to check in; unconfirmed guests need explicit confirmation | Open product question |
| Quiet hours | Default 21:00-09:00 event time, deferral not skipping | Per-workspace setting |
| Message cost | Placeholder per-message rates in config | Replace with provider pricing before live use |
| Reminders | Organizer-created campaigns with audience targeting and a send time; automatic cadence rules are not built | Backlog |
| Data retention | Exports/import files 7 days, deletion grace 7 days, suppression + audit kept | Env-configurable; needs legal confirmation |
| Languages | English and Hindi for guest pages and message templates; organizer UI English | Hindi copy needs native proofreading |
| Billing | Not implemented (usage counters only) | Out of MVP per the implementation contract |
