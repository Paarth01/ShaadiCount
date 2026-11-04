# Tenant Isolation and Privacy Engineering Checklist

Use this checklist during implementation review and before every production release.

## Identity and workspace scope
- [ ] Authenticated identity is established by server-controlled auth middleware.
- [ ] Every workspace resource query includes authorized workspace scope.
- [ ] Child-to-parent relationships are verified across the full chain: workspace → event → function → invitation → guest/response/check-in/message.
- [ ] Composite foreign keys or equivalent database constraints prevent cross-workspace references.
- [ ] Role checks are enforced in service/domain code for each operation.
- [ ] Public RSVP token cannot be used to enumerate guests, functions or workspaces.
- [ ] Test suite attempts ID substitution and cross-tenant access for every resource family.

## Secrets and tokens
- [ ] RSVP token entropy is adequate; only hash is persisted.
- [ ] Tokens are revocable/expirable and not written to logs, analytics, crash reports or referrer headers.
- [ ] Session/auth secrets and provider credentials are in secret management, not source or database plaintext.
- [ ] Webhook signatures are verified before parsing/trusting provider events.
- [ ] Key rotation and emergency revocation steps are documented.

## Personal data and logs
- [ ] Logs use opaque IDs and redact phone numbers, message content, tokens and provider payloads.
- [ ] Public guest pages reveal only fields necessary for that invitation.
- [ ] Catering exports are aggregate-only by default; contact exports require a specific role/permission.
- [ ] Import/export artifacts are private, short-lived and access-controlled.
- [ ] Retention and deletion behavior is documented for primary data, derived data, exports, logs and backups.
- [ ] Opt-outs/suppression and audit evidence are retained according to an approved policy and not silently erased.

## Messaging safety
- [ ] Every recipient is revalidated immediately before dispatch.
- [ ] Opt-out and suppression checks override queued campaigns.
- [ ] Rate limits, spend limits, pause/kill switch and fake-provider tests exist.
- [ ] Live messaging is disabled by default and cannot be enabled by an ordinary workspace member.

## Operational readiness
- [ ] Dependencies are scanned and patched according to policy.
- [ ] Backups are encrypted, access-restricted and restore-tested.
- [ ] Incident and access-review procedures exist.
- [ ] Security issues and privacy requests have an owner and escalation path.
- [ ] Independent security/legal review has occurred before production launch.
