# Schema Reference (Initial)

Core tables: `users`, `workspaces`, `workspace_members`, `events`, `event_functions`, `guest_groups`, `guests`, `event_invitations`, `rsvp_responses`, `rsvp_response_history`, `message_campaigns`, `scheduled_messages`, `message_attempts`, `provider_webhook_events`, `communication_preferences`, `communication_consents`, `check_ins`, `catering_estimates`, `subscriptions`, `billing_records`, `audit_logs`, `outbox_events`, `idempotency_records`.

Required invariants:
- Unique membership `(workspace_id, user_id)`.
- Unique invitation `(event_function_id, guest_id)`.
- One current RSVP per invitation.
- Unique provider webhook `(provider, provider_event_id)`.
- Idempotency records scoped by `(workspace_id, operation, idempotency_key)`.
- Check-in uniqueness prevents duplicate active check-in for the same invitation/function; re-entry rules require explicit product decision.
- RSVP response writes use a transaction and optimistic version check.
- Index `(workspace_id, event_id)`, `(event_function_id, status)`, `(scheduled_at, status)`, and provider status indexes based on observed queries.

Soft delete: use `deleted_at` for user-managed guests/events where recovery is useful. Do not soft-delete opt-out/suppression evidence or audit records without a reviewed retention policy. Deletion workflows must propagate to exports, derived analytics and backups under documented expiry windows.

Retention: provisional defaults only; counsel and provider contracts must confirm. Keep raw import files briefly (e.g. 7 days after successful processing), exports briefly (e.g. 7 days), and minimize provider payload retention. Never log RSVP tokens or full phone numbers.
