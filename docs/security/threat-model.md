# Threat Model

## Assets
Guest names/contact details, invitation tokens, RSVP counts, event locations/times, response history, payment/subscription records, provider credentials, exported files and audit logs.

## Threats and controls
- Cross-tenant IDOR: scope every query by authenticated workspace membership; enforce composite foreign keys and optionally PostgreSQL RLS; test negative access cases.
- RSVP token leakage: high-entropy random token, store only hash, no token in analytics/logs/referrers, `Referrer-Policy: no-referrer`, revocation/expiry and rate limits.
- Guest enumeration: generic invalid-token response, no directory search publicly, abuse throttling.
- CSV injection: validate imports and neutralize spreadsheet formula prefixes on exports.
- SQL injection: parameterized queries and ORM-safe patterns; no string-built SQL from input.
- XSS/CSRF: output encoding, CSP, secure SameSite cookies and CSRF protection for cookie-authenticated state changes.
- Webhook spoof/replay: verify provider signature, timestamp/replay where supported, deduplicate event IDs and limit body size.
- Queue poisoning: validate payload schemas, allowlist job types, tenant-aware authorization and dead-letter handling.
- Secret leakage: managed secret store, no secrets in Git/logs, rotation and scoped credentials.
- DoS/noisy tenant: per-IP, per-token and per-tenant limits, request/body limits, quotas and backpressure.
- Backup exposure: encrypted backups, least-privilege restore role, restore drills and access logs.
- Privilege escalation: explicit role matrix, deny-by-default authorization, audited role changes and MFA for platform administrators.
- SSRF: do not fetch arbitrary user-provided URLs; allowlist provider endpoints and block private IP ranges if URL fetching is ever introduced.
- Payment forgery: verify gateway signature against raw request body, deduplicate events and reconcile against gateway state.

## Security baseline
TLS everywhere; encryption at rest via managed storage; secrets manager; short-lived sessions and refresh rotation; secure headers; dependency/container scanning; SAST/DAST; least privilege; audited admin access; incident playbook; encrypted backups; key rotation; periodic access review.
