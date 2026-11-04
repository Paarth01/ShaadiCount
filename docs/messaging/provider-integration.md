# Messaging Provider Integration

## Provider abstraction
Define `MessagingProvider.send(template, recipient, variables, idempotencyKey)` and normalized statuses: `queued`, `submitted`, `delivered`, `read` (only if supported), `failed`, `unknown`, `cancelled`, `skipped`. Do not map provider acceptance to delivery.

## Dispatch rules
1. Scheduler creates a durable scheduled message/outbox record.
2. Worker acquires a short lease or uses queue-level deduplication, then rechecks eligibility in PostgreSQL.
3. Apply tenant and provider rate limits.
4. Persist attempt before/around network dispatch with an attempt identifier.
5. On success, store provider message ID and `submitted`.
6. On timeout, use `unknown` unless provider idempotency/status lookup resolves it.
7. Provider callbacks are verified, deduplicated, durably acknowledged, and processed asynchronously.
8. Retry transient failures with exponential backoff and jitter; permanent template/recipient errors go to terminal failure.
9. Dead-letter messages after bounded retries and provide audited replay.

## Provider validation checklist
- Official API access and business verification requirements
- Template categories, review and variable rules
- Conversation/window policy and current pricing
- Throughput limits and quality/rate limits
- Webhook signature verification, retry policy and event IDs
- Opt-out/consent and data processing terms
- India-specific SMS Principal Entity, header, content template, consent and DLT requirements where applicable
- Provider sandbox and test numbers
- Regional data processing and subprocessors

No unofficial WhatsApp automation, browser scraping, personal-account automation or unauthorized bulk messaging.


---

## Release gate as implemented

Live sending is **off by default and fails closed**.

- Default: `MESSAGING_MODE=fake`, `LIVE_MESSAGING_ENABLED=false`. The sandbox provider never touches the network (a test blocks `fetch`, `http(s).request` and non-database sockets during a full send cycle).
- `loadConfig()` refuses to start if live is requested without **all** of: `LIVE_PROVIDER_NAME`, `LIVE_PROVIDER_CREDENTIALS_REF`, `LIVE_TEMPLATE_APPROVAL_REF`, `LIVE_CONSENT_POLICY_REF`, `LIVE_OPT_OUT_POLICY_REF`, `LIVE_SPEND_CAP_PAISE`, `MESSAGING_WEBHOOK_SECRET`, and `LIVE_MESSAGING_ENABLED=true`.
- Even then, `LiveProviderStub` rejects every send (`LIVE_PROVIDER_NOT_IMPLEMENTED`): **no real WhatsApp/SMS/email adapter exists in this repository**. Writing and verifying one against the chosen provider's current documentation is a separate, explicitly authorised task.
- Per-message guards that apply to every provider: attestation of authority, recorded consent evidence per guest and channel, no active suppression, quiet hours in the event time zone, per-workspace rate limit and spend cap, explicit organizer confirmation of recipient count and estimated cost, re-check of eligibility immediately before each provider call, deterministic idempotency key, retry/backoff with dead-lettering, signed and de-duplicated provider callbacks.
- All templates are marked `approvedForLive: false`; scheduling in live mode is refused for unapproved templates.
- Cost figures are **placeholder configuration values**, not provider pricing.
