# Release Readiness Checklist

A release is not ready merely because the app builds. Mark each item `Pass`, `Fail`, `Not applicable` with evidence and owner.

## Product and operations
- [ ] Pilot scope and supported workflows approved.
- [ ] Planner/host and guest usability checks completed on Android/mobile browsers.
- [ ] RSVP, deadline, override, household and check-in policies approved.
- [ ] Support contact, escalation process and incident owner identified.
- [ ] Known limitations communicated; no unsupported food-waste or attendance-guarantee claims.

## Security and privacy
- [ ] Tenant isolation tests pass.
- [ ] Roles and exports reviewed.
- [ ] Privacy notice, consent language and opt-out experience reviewed by qualified owner/counsel.
- [ ] Data retention/deletion/backup expiry approved.
- [ ] Secrets, TLS, backups, logs, vulnerability scans and restore procedure checked.
- [ ] Relevant Indian DPDP, telecom/TRAI, consumer, tax and contractual applicability reviewed by qualified counsel/provider.

## Messaging
- [ ] Provider account ownership and onboarding verified.
- [ ] Approved templates and valid sender configuration verified.
- [ ] Recipient permission evidence and opt-out/suppression workflow tested.
- [ ] Webhook signature verification and deduplication tested.
- [ ] Per-event/workspace/global rate and cost caps configured.
- [ ] Kill switch, campaign pause and incident procedure tested.
- [ ] Live messaging is still disabled if any item above is incomplete.

## Engineering
- [ ] Fresh migrations pass in CI.
- [ ] Unit, integration, end-to-end and acceptance tests pass.
- [ ] Lint, type-check, build and dependency/security checks pass.
- [ ] API docs match actual behavior.
- [ ] Monitoring/alerts and safe error reporting are configured.
- [ ] Deployment, rollback/mitigation and backup restoration have been rehearsed.
- [ ] Performance has been tested against pilot assumptions; no unsupported scale claims.

## Pilot evidence
- [ ] Baseline and measurement method documented.
- [ ] Response rate, time saved, message delivery/failure/opt-out, headcount changes and actual check-ins measured.
- [ ] Catering estimates are compared with actual check-ins and meal counts where available.
- [ ] Paid conversion/willingness-to-pay evidence recorded separately from usage metrics.
- [ ] Product owner approves next step based on evidence, not assumptions.
