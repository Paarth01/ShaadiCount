# Data Inventory and Retention

| Data | Purpose | Access | Proposed retention |
|---|---|---|---|
| User identity/session | Authentication | User, auth service | Account lifetime plus reviewed security period |
| Guest name/contact | Invitation and RSVP | Authorized workspace roles | Event lifecycle plus short support window; then delete/anonymize |
| RSVP response/history | Planning and audit | Organizer roles; restricted reports | Event lifecycle and justified dispute window |
| Child/adult counts | Catering | Organizer/caterer if authorized | Prefer counts only; no child identity |
| Message metadata | Delivery/retry/cost | Messaging roles | Minimize; provider-contract and dispute needs reviewed |
| Raw provider webhook | State reconciliation | Restricted service operators | Keep minimum payload/period; redact PII |
| Import files | Import processing | Import worker/owner | Suggested 7 days after success |
| Exports | User download | Authorized requester | Suggested 7 days, then delete |
| Billing records | Subscription/tax/accounting | Billing/admin | Statutory/accounting retention confirmed by counsel |
| Audit/security logs | Security and accountability | Restricted admins | Defined schedule, tamper resistance and access controls |

These are proposed starting values, not final legal retention periods. Implement deletion jobs and verify propagation to derived data, object storage and backups according to documented expiry behavior.
