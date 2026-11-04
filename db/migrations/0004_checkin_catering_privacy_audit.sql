-- 0004: check-ins, catering, imports/exports, privacy requests, audit log, analytics.

CREATE TABLE check_ins (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL,
  event_function_id uuid NOT NULL,
  invitation_id     uuid NOT NULL,
  checked_in_at     timestamptz NOT NULL DEFAULT now(),
  checked_in_by     uuid REFERENCES users(id),
  adults_present    integer NOT NULL DEFAULT 0 CHECK (adults_present BETWEEN 0 AND 100),
  children_present  integer NOT NULL DEFAULT 0 CHECK (children_present BETWEEN 0 AND 100),
  method            text NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','qr')),
  note              text CHECK (note IS NULL OR char_length(note) <= 300),
  voided_at         timestamptz,
  voided_by         uuid REFERENCES users(id),
  void_reason       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (adults_present + children_present >= 1),
  CHECK (voided_at IS NULL OR (voided_by IS NOT NULL AND void_reason IS NOT NULL)),
  FOREIGN KEY (workspace_id, event_function_id, invitation_id)
    REFERENCES event_invitations (workspace_id, event_function_id, id)
);
-- One ACTIVE check-in per invitation per function; a voided one may be followed by a corrected one.
CREATE UNIQUE INDEX one_active_checkin_uq ON check_ins (event_function_id, invitation_id) WHERE voided_at IS NULL;
CREATE INDEX check_ins_function_idx ON check_ins (event_function_id) WHERE voided_at IS NULL;

CREATE TABLE catering_settings (
  workspace_id          uuid NOT NULL,
  event_function_id     uuid NOT NULL,
  maybe_weight_percent  numeric(5,2) NOT NULL DEFAULT 50 CHECK (maybe_weight_percent BETWEEN 0 AND 100),
  pending_weight_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (pending_weight_percent BETWEEN 0 AND 100),
  buffer_percent        numeric(5,2) NOT NULL DEFAULT 5  CHECK (buffer_percent BETWEEN 0 AND 100),
  meal_rounding         integer NOT NULL DEFAULT 1 CHECK (meal_rounding BETWEEN 1 AND 100),
  adult_price_paise     bigint CHECK (adult_price_paise IS NULL OR adult_price_paise >= 0),
  child_price_paise     bigint CHECK (child_price_paise IS NULL OR child_price_paise >= 0),
  updated_by            uuid REFERENCES users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, event_function_id),
  FOREIGN KEY (workspace_id, event_function_id) REFERENCES event_functions (workspace_id, id)
);

CREATE TABLE catering_estimates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL,
  event_function_id       uuid NOT NULL,
  label                   text CHECK (label IS NULL OR char_length(label) <= 120),
  confirmed_adults        integer NOT NULL,
  confirmed_children      integer NOT NULL,
  tentative_people        integer NOT NULL,
  pending_people          integer NOT NULL,
  planning_buffer_percent numeric(5,2) NOT NULL CHECK (planning_buffer_percent BETWEEN 0 AND 100),
  adult_meals             integer NOT NULL,
  child_meals             integer NOT NULL,
  estimated_meals         integer NOT NULL,
  adult_price_paise       bigint,
  child_price_paise       bigint,
  estimated_cost_paise    bigint,
  assumptions             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by              uuid REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, event_function_id) REFERENCES event_functions (workspace_id, id)
);
CREATE INDEX catering_estimates_idx ON catering_estimates (event_function_id, created_at DESC);

CREATE TABLE import_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  event_id     uuid NOT NULL,
  created_by   uuid REFERENCES users(id),
  status       text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','committed','expired')),
  filename     text,
  raw_csv      text,                         -- purged 7 days after creation/commit (see retention job)
  mapping      jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview      jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  result       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  expires_at   timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, event_id) REFERENCES events (workspace_id, id)
);

CREATE TABLE export_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id),
  event_id        uuid,
  function_id     uuid,
  kind            text NOT NULL CHECK (kind IN ('guests','rsvps','catering','checkins','workspace_data')),
  requested_by    uuid REFERENCES users(id),
  status          text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','expired')),
  content_type    text NOT NULL,
  content         text,                      -- stored privately in the database for the MVP; deleted at expiry
  row_count       integer NOT NULL DEFAULT 0,
  download_count  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
CREATE INDEX export_jobs_expiry_idx ON export_jobs (expires_at) WHERE status = 'ready';

CREATE TABLE data_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  type          text NOT NULL CHECK (type IN ('export','deletion')),
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','scheduled','completed','blocked','cancelled')),
  requested_by  uuid NOT NULL REFERENCES users(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  execute_after timestamptz,
  completed_at  timestamptz,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  export_job_id uuid REFERENCES export_jobs(id)
);
CREATE INDEX data_requests_due_idx ON data_requests (execute_after) WHERE status = 'scheduled';

CREATE TABLE audit_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid REFERENCES workspaces(id),
  actor_user_id     uuid REFERENCES users(id),
  actor_type        text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','guest','system','provider')),
  request_id        text,
  action            text NOT NULL,
  resource_type     text NOT NULL,
  resource_id       uuid,
  reason            text,
  metadata_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_workspace_time_idx ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX audit_action_idx ON audit_logs (action, created_at DESC);
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- Aggregate, pseudonymous product analytics. Never contains names, phones, tokens or free text.
CREATE TABLE analytics_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_pseudo   text,
  event_pseudo       text,
  name               text NOT NULL,
  properties         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_name_idx ON analytics_events (name, created_at DESC);
