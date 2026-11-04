-- 0003: consent, suppression, campaigns, scheduled messages, attempts, webhooks, outbox, idempotency, fake provider sandbox.

CREATE TABLE communication_consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  event_id      uuid NOT NULL,
  guest_id      uuid NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  status        text NOT NULL CHECK (status IN ('granted','revoked')),
  basis         text NOT NULL CHECK (basis IN ('organizer_attestation','guest_opt_in')),
  evidence_note text NOT NULL CHECK (char_length(evidence_note) BETWEEN 3 AND 500),
  recorded_by   uuid REFERENCES users(id),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, event_id, guest_id) REFERENCES guests (workspace_id, event_id, id)
);
CREATE INDEX consents_lookup_idx ON communication_consents (guest_id, channel, recorded_at DESC);

-- Suppression/opt-out evidence is deliberately NOT linked to guests and is never cascaded away by guest deletion.
-- It stores a keyed hash of the contact plus a masked display value, so it survives erasure of the guest record.
CREATE TABLE communication_suppressions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id),
  channel        text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  contact_hash   text NOT NULL,
  contact_masked text NOT NULL,
  reason         text NOT NULL CHECK (reason IN ('opted_out','organizer_added','bounce','complaint')),
  source         text NOT NULL CHECK (source IN ('guest_reply','provider_webhook','organizer','system')),
  guest_id       uuid,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  lifted_at      timestamptz,
  lifted_by      uuid REFERENCES users(id),
  lift_reason    text,
  CHECK (lifted_at IS NULL OR (lifted_by IS NOT NULL AND lift_reason IS NOT NULL))
);
CREATE UNIQUE INDEX suppressions_active_uq ON communication_suppressions (workspace_id, channel, contact_hash) WHERE lifted_at IS NULL;

CREATE TABLE message_campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL,
  event_id             uuid NOT NULL,
  event_function_id    uuid NOT NULL,
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  kind                 text NOT NULL CHECK (kind IN ('invitation','reminder')),
  channel              text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  template_key         text NOT NULL,
  template_version     integer NOT NULL,
  audience             text NOT NULL CHECK (audience IN ('all_invited','not_responded','maybe','not_yet_messaged')),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','paused','running','completed','cancelled')),
  scheduled_at         timestamptz,
  estimated_recipients integer,
  estimated_cost_paise bigint,
  created_by           uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  confirmed_by         uuid REFERENCES users(id),
  confirmed_at         timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, event_function_id, id),
  FOREIGN KEY (workspace_id, event_id, event_function_id) REFERENCES event_functions (workspace_id, event_id, id)
);
CREATE INDEX campaigns_function_idx ON message_campaigns (event_function_id, status);

CREATE TABLE scheduled_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL,
  event_function_id    uuid NOT NULL,
  campaign_id          uuid NOT NULL,
  invitation_id        uuid NOT NULL,
  channel              text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  template_key         text NOT NULL,
  template_version     integer NOT NULL,
  language             text NOT NULL CHECK (language IN ('en','hi')),
  scheduled_at         timestamptz NOT NULL,
  next_attempt_at      timestamptz NOT NULL,
  status               text NOT NULL DEFAULT 'scheduled'
                         CHECK (status IN ('scheduled','queued','submitted','delivered','read','failed','unknown','cancelled','skipped')),
  skip_reason          text,
  attempt_count        integer NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  idempotency_key      text NOT NULL UNIQUE,
  provider             text,
  provider_message_id  text,
  estimated_cost_paise integer NOT NULL DEFAULT 0,
  last_error_code      text,
  dead_lettered_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (campaign_id, invitation_id),
  FOREIGN KEY (workspace_id, event_function_id, campaign_id)   REFERENCES message_campaigns (workspace_id, event_function_id, id),
  FOREIGN KEY (workspace_id, event_function_id, invitation_id) REFERENCES event_invitations (workspace_id, event_function_id, id)
);
CREATE INDEX scheduled_due_idx ON scheduled_messages (next_attempt_at) WHERE status = 'scheduled';
CREATE INDEX scheduled_lease_idx ON scheduled_messages (locked_until) WHERE status = 'queued';
CREATE INDEX scheduled_provider_idx ON scheduled_messages (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX scheduled_campaign_idx ON scheduled_messages (campaign_id, status);
CREATE INDEX scheduled_invitation_idx ON scheduled_messages (invitation_id);

CREATE TABLE message_attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL,
  scheduled_message_id uuid NOT NULL,
  attempt_number       integer NOT NULL,
  status               text NOT NULL CHECK (status IN ('started','submitted','transient_error','permanent_error','timeout')),
  provider_message_id  text,
  error_code           text,
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  UNIQUE (scheduled_message_id, attempt_number),
  FOREIGN KEY (workspace_id, scheduled_message_id) REFERENCES scheduled_messages (workspace_id, id)
);

CREATE TABLE message_status_history (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL,
  scheduled_message_id uuid NOT NULL,
  from_status          text,
  to_status            text NOT NULL,
  source               text NOT NULL CHECK (source IN ('scheduler','worker','webhook','organizer','system')),
  provider_event_id    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, scheduled_message_id) REFERENCES scheduled_messages (workspace_id, id)
);
CREATE INDEX message_status_history_idx ON message_status_history (scheduled_message_id, created_at);

CREATE TABLE provider_webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  provider_event_id text NOT NULL,
  workspace_id      uuid REFERENCES workspaces(id),
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  payload_redacted  jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending'
                      CHECK (processing_status IN ('pending','processed','unmatched','ignored','failed')),
  UNIQUE (provider, provider_event_id)
);

-- Sandbox "provider" storage used only by the fake provider (local/test). Synthetic data only.
CREATE TABLE fake_provider_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key     text NOT NULL UNIQUE,
  provider_message_id text NOT NULL UNIQUE,
  workspace_id        uuid NOT NULL,
  channel             text NOT NULL,
  to_masked           text NOT NULL,
  template_key        text NOT NULL,
  language            text NOT NULL,
  body                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid REFERENCES workspaces(id),
  event_type       text NOT NULL,
  aggregate_id     uuid NOT NULL,
  payload          jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  dead_lettered_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_events (next_attempt_at, created_at)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE TABLE idempotency_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key       text NOT NULL,                   -- '<workspaceId|public>|<actor>'
  operation       text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash    text NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  UNIQUE (scope_key, operation, idempotency_key)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_records (expires_at);
