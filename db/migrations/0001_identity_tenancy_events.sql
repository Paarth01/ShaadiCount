-- 0001: identity, sessions, workspaces, membership, events, functions, assignments.
-- Forward-only. Rollback/mitigation: restore from backup or ship a forward fix (see docs/database/migration-plan.md).
-- Lock/downtime risk: none (initial creation). Backfill: none.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  token_hash   text NOT NULL UNIQUE,            -- SHA-256 of the opaque cookie value; plaintext is never stored
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE workspaces (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  created_by                      uuid NOT NULL REFERENCES users(id),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  deleted_at                      timestamptz,
  -- Organizer attestation that they have authority to upload and contact invitees (separate from per-channel permission).
  contact_authority_attested_at   timestamptz,
  contact_authority_attested_by   uuid REFERENCES users(id),
  message_spend_cap_paise         bigint CHECK (message_spend_cap_paise IS NULL OR message_spend_cap_paise >= 0),
  quiet_hours_start               smallint NOT NULL DEFAULT 21 CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end                 smallint NOT NULL DEFAULT 9  CHECK (quiet_hours_end BETWEEN 0 AND 23)
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  role         text NOT NULL CHECK (role IN ('owner','organizer','planner','checkin_staff','readonly','caterer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  timezone     text NOT NULL CHECK (char_length(timezone) BETWEEN 3 AND 64),  -- IANA name, validated in the service
  start_date   date,
  end_date     date,
  host_name    text CHECK (host_name IS NULL OR char_length(host_name) <= 160),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled','archived')),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  UNIQUE (workspace_id, id)
);
CREATE INDEX events_workspace_idx ON events (workspace_id, status) WHERE deleted_at IS NULL;

CREATE TABLE event_functions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL,
  event_id             uuid NOT NULL,
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  starts_at            timestamptz NOT NULL,
  venue                text CHECK (venue IS NULL OR char_length(venue) <= 200),
  capacity             integer CHECK (capacity IS NULL OR capacity >= 0),
  rsvp_deadline        timestamptz,
  allow_response_edits boolean NOT NULL DEFAULT true,
  allow_children       boolean NOT NULL DEFAULT true,      -- child-count policy
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','cancelled','completed')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (rsvp_deadline IS NULL OR rsvp_deadline <= starts_at),
  UNIQUE (event_id, name),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, event_id, id),
  FOREIGN KEY (workspace_id, event_id) REFERENCES events (workspace_id, id)
);

-- Scope for roles that only see assigned events (planner, readonly, caterer) or functions (checkin_staff).
CREATE TABLE member_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id      uuid NOT NULL,
  event_id     uuid NOT NULL,
  function_id  uuid,                                      -- NULL = whole event
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id),
  FOREIGN KEY (workspace_id, user_id)  REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, event_id) REFERENCES events (workspace_id, id),
  FOREIGN KEY (workspace_id, event_id, function_id) REFERENCES event_functions (workspace_id, event_id, id)
);
CREATE UNIQUE INDEX member_assign_event_uq ON member_assignments (workspace_id, user_id, event_id) WHERE function_id IS NULL;
CREATE UNIQUE INDEX member_assign_function_uq ON member_assignments (workspace_id, user_id, function_id) WHERE function_id IS NOT NULL;

-- Shared append-only guard used by audit/history tables. DELETE is only allowed inside an explicit, audited purge
-- (SET LOCAL app.allow_purge = 'on'); UPDATE is never allowed.
CREATE FUNCTION prevent_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
