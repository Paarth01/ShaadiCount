# Messaging Provider Adapter Contract

## Purpose
Separate product workflows from provider-specific WhatsApp/SMS/email SDKs. Provider integration must be replaceable without changing RSVP or campaign business logic.

## Interface responsibilities
A provider adapter should expose equivalents of:
- `validateConfiguration()` — confirms required credentials/configuration exist without returning secrets.
- `validateRecipientEligibility(recipient, channel, template)` — product eligibility is checked before provider dispatch; provider validation is additional, not a replacement.
- `sendTemplate(message)` — submits an approved template using a stable internal message ID and returns provider message ID/status.
- `verifyWebhook(rawBody, headers)` — verifies authenticity before parsing.
- `normalizeWebhook(event)` — maps provider event to normalized `submitted`, `delivered`, `read`, `failed`, `unknown`, `opted_out` where supported.
- `healthCheck()` — returns sanitized operational status.

## Normalized message lifecycle
`draft -> scheduled -> queued -> submitted -> delivered/read` or `failed/unknown/cancelled/skipped`. Provider events can arrive late, duplicated or out of order. Store raw status transition history safely and apply monotonic/valid transition rules; do not downgrade a terminal state because an older webhook arrived. A provider `submitted` response is not delivery confirmation.

## Safety and reliability
- Fake provider is default in local/test environments and should support deterministic simulated success/failure/webhooks.
- Live provider adapter is disabled unless an explicit feature flag and valid deployment configuration are present.
- Check permission/consent evidence, opt-out/suppression, valid number, channel eligibility, template approval status and campaign pause state immediately before sending—not only at campaign creation.
- Deduplicate webhooks by `(provider, provider_event_id)` and make processing idempotent.
- Retry only transient errors, with bounded exponential backoff and jitter; do not retry permanent policy/template/invalid-recipient errors indefinitely.
- Apply per-workspace and global rate/cost limits. Provide dry-run preview and estimated message count/cost before scheduling.
- On pause/cancel, stop unsent work; document race behavior for already submitted messages.
- Never log message body, full phone number, invitation token or credentials. Redact provider error payloads.
- Keep message sends in a durable queue/outbox so database state and queue publication cannot silently diverge.

## Provider and compliance release gate
Before enabling a real channel, human owners must verify current official provider documentation, account model, business verification, templates, opt-in requirements, opt-out mechanism, country-specific pricing, throughput/quality limits, webhook security, data processing terms and Indian telecom/privacy obligations where applicable. Store evidence/date/owner in the deployment checklist. No legal conclusion should be inferred from this adapter specification.
