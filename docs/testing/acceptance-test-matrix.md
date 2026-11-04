# Acceptance Test Matrix

These tests supplement `test-strategy.md`. Each row should map to automated tests and, where relevant, a manual pilot check. Do not mark a row passed without evidence.

| ID | Scenario | Expected result |
|---|---|---|
| AUTH-01 | Anonymous user requests organizer endpoint | `401`; no data leaked |
| TENANT-01 | Workspace A member requests Workspace B event/guest/message | Denied; no existence or PII leak beyond documented response |
| ROLE-01 | Check-in staff attempts export or campaign send | Denied and audited where required |
| EVENT-01 | Create event with invalid timezone or invalid function time | Validation error; no partial data |
| GUEST-01 | CSV contains malformed rows and duplicate contacts | Preview identifies row errors/duplicates; no import until explicit commit |
| INV-01 | Guest invited to function A requests function B with same token | Denied; no data from function B disclosed |
| RSVP-01 | Valid yes RSVP within party limit | Response saved; version/history updated; dashboard totals recalculate |
| RSVP-02 | RSVP count exceeds permitted party size | Rejected unless authorized override is used and audited |
| RSVP-03 | Concurrent update with stale version | `409`; current state preserved; user can refresh |
| RSVP-04 | Expired/revoked/random public token | Generic failure, rate-limited, no token detail in logs |
| RSVP-05 | Deadline has passed | Public edit blocked according to policy; authorized override audited |
| MSG-01 | Campaign preview with opt-out or missing permission | Recipient excluded with safe reason; no provider call |
| MSG-02 | Live messaging flag is off | Fake provider only; no outbound network send |
| MSG-03 | Duplicate provider webhook | Side effects applied once |
| MSG-04 | Temporary provider error | Bounded retry/backoff; status visible; no duplicate logical message |
| MSG-05 | Campaign paused while jobs are pending | Unsent messages do not dispatch after pause takes effect |
| MSG-06 | Invalid template or unverified webhook signature | No send or no webhook processing; security event recorded safely |
| CHECKIN-01 | Same invitation scanned twice | Duplicate active check-in prevented and clear feedback shown |
| CHECKIN-02 | Unauthorized user attempts check-in correction | Denied; authorized correction creates audit record |
| CATER-01 | RSVP totals change | Estimate recalculates using documented rules and records assumptions/time |
| CATER-02 | Dashboard shows estimates | Confirmed, tentative, unanswered and actual check-ins remain distinct |
| PRIV-01 | Guest opts out | Suppression applied before next dispatch; evidence retained according to policy |
| PRIV-02 | User requests export/deletion | Authorized workflow executes and records completion/blockers; backups follow documented expiry |
| TIME-01 | Event is in a non-UTC timezone across daylight-saving transition | Deadline/reminder scheduling matches event-local time semantics |
| REL-01 | Worker restarts after claiming a job | No lost logical work; retries/idempotency prevent duplicate effects |
| DB-01 | Fresh database migration | All migrations succeed and schema checks pass |
| OBS-01 | Error occurs in request/job | Correlation/request ID present; secrets/tokens/phone numbers absent from logs |

## Pilot manual checks
- A planner can import a realistic CSV and correct mistakes without developer help.
- A guest can RSVP on a low-end Android browser without installing an app or creating an account.
- The organizer can identify non-responders and see current counts per function.
- A caterer can interpret the exported totals and assumptions without access to guest phone numbers.
- Message previews and test sends are understandable; opt-out and pause flows are verified before any live campaign.
