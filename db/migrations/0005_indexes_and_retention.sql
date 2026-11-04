-- Supporting indexes found missing during the production audit.
-- The dispatcher counts recent attempts per workspace before every send; with only the UNIQUE(scheduled_message_id,
-- attempt_number) index that count scanned the whole table, making dispatch quadratic as history grew.
CREATE INDEX IF NOT EXISTS message_attempts_rate_idx ON message_attempts (workspace_id, started_at DESC);

-- Spend-cap check sums estimated cost per workspace across non-terminal messages.
CREATE INDEX IF NOT EXISTS scheduled_workspace_status_idx ON scheduled_messages (workspace_id, status);

-- Retention jobs delete old published outbox rows and processed webhook events.
CREATE INDEX IF NOT EXISTS outbox_published_idx ON outbox_events (published_at) WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS webhook_received_idx ON provider_webhook_events (received_at);
CREATE INDEX IF NOT EXISTS attempts_started_idx ON message_attempts (started_at);
