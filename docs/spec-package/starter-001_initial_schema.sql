-- Illustrative PostgreSQL baseline; review and expand before production.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  phone_e164 text UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','organizer','co_organizer','planner','caterer','checkin_staff','readonly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, id)
);

CREATE TABLE event_functions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  event_id uuid NOT NULL REFERENCES events(id),
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  venue text,
  capacity integer CHECK (capacity IS NULL OR capacity >= 0),
  rsvp_deadline timestamptz,
  allow_response_edits boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','cancelled','completed')),
  UNIQUE (event_id, name),
  UNIQUE (workspace_id, id)
);

CREATE TABLE guest_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, id)
);

CREATE TABLE guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  guest_group_id uuid REFERENCES guest_groups(id),
  display_name text NOT NULL,
  phone_e164 text,
  preferred_language text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, id)
);

CREATE TABLE event_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  event_function_id uuid NOT NULL REFERENCES event_functions(id),
  guest_id uuid NOT NULL REFERENCES guests(id),
  invited_party_size integer NOT NULL CHECK (invited_party_size >= 1),
  token_hash text NOT NULL UNIQUE,
  token_expires_at timestamptz,
  revoked_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','responded','expired','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_function_id, guest_id),
  UNIQUE (workspace_id, id)
);

CREATE TABLE rsvp_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  invitation_id uuid NOT NULL UNIQUE REFERENCES event_invitations(id),
  status text NOT NULL CHECK (status IN ('yes','no','maybe')),
  adult_count integer NOT NULL DEFAULT 0 CHECK (adult_count >= 0),
  child_count integer NOT NULL DEFAULT 0 CHECK (child_count >= 0),
  version integer NOT NULL DEFAULT 1,
  responded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'yes' AND adult_count + child_count >= 1) OR status IN ('no','maybe'))
);

CREATE TABLE rsvp_response_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  invitation_id uuid NOT NULL REFERENCES event_invitations(id),
  previous_status text,
  new_status text NOT NULL,
  previous_adult_count integer,
  previous_child_count integer,
  new_adult_count integer NOT NULL,
  new_child_count integer NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('guest','organizer','system')),
  actor_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id),
  event_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_events(next_attempt_at, created_at) WHERE published_at IS NULL;

CREATE TABLE message_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  event_function_id uuid NOT NULL REFERENCES event_functions(id),
  channel text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  template_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','paused','running','completed','cancelled')),
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  campaign_id uuid NOT NULL REFERENCES message_campaigns(id),
  invitation_id uuid NOT NULL REFERENCES event_invitations(id),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','queued','submitted','delivered','read','failed','unknown','cancelled','skipped')),
  idempotency_key text NOT NULL UNIQUE,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_due_idx ON scheduled_messages(scheduled_at, status);

CREATE TABLE message_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  scheduled_message_id uuid NOT NULL REFERENCES scheduled_messages(id),
  attempt_number integer NOT NULL,
  status text NOT NULL,
  provider_message_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheduled_message_id, attempt_number)
);

CREATE TABLE provider_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  payload_redacted jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending',
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  event_function_id uuid NOT NULL REFERENCES event_functions(id),
  invitation_id uuid NOT NULL REFERENCES event_invitations(id),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_in_by uuid REFERENCES users(id),
  voided_at timestamptz,
  note text
);
CREATE UNIQUE INDEX one_active_checkin_per_invitation ON check_ins(invitation_id) WHERE voided_at IS NULL;

CREATE TABLE catering_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  event_function_id uuid NOT NULL REFERENCES event_functions(id),
  confirmed_adults integer NOT NULL,
  confirmed_children integer NOT NULL,
  tentative_people integer NOT NULL,
  planning_buffer_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (planning_buffer_percent >= 0 AND planning_buffer_percent <= 100),
  adult_price_paise bigint,
  child_price_paise bigint,
  estimated_meals integer NOT NULL,
  estimated_cost_paise bigint,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  reason text,
  metadata_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_workspace_time_idx ON audit_logs(workspace_id, created_at DESC);

-- Production hardening required: composite tenant-safe foreign keys, RLS policies,
-- communication consents/preferences, imports/exports, billing, subscriptions,
-- idempotency records, and provider-specific fields must be added before launch.
