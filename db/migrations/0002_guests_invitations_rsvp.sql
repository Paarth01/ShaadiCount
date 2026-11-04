-- 0002: guest groups, guests, function-specific invitations, RSVP responses and history.
-- All child rows carry workspace_id and reference parents through composite keys so a row owned by
-- workspace A can never point at a parent owned by workspace B.

CREATE TABLE guest_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  event_id     uuid NOT NULL,
  label        text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (workspace_id, event_id, id),
  FOREIGN KEY (workspace_id, event_id) REFERENCES events (workspace_id, id)
);
CREATE UNIQUE INDEX guest_groups_label_uq ON guest_groups (event_id, lower(label)) WHERE deleted_at IS NULL;

CREATE TABLE guests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL,
  event_id           uuid NOT NULL,
  guest_group_id     uuid,
  display_name       text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  phone_e164         text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email              text CHECK (email IS NULL OR char_length(email) <= 254),
  preferred_language text NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en','hi')),
  tags               text[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  anonymized_at      timestamptz,
  UNIQUE (workspace_id, event_id, id),
  FOREIGN KEY (workspace_id, event_id) REFERENCES events (workspace_id, id),
  FOREIGN KEY (workspace_id, event_id, guest_group_id) REFERENCES guest_groups (workspace_id, event_id, id)
);
CREATE INDEX guests_event_idx ON guests (workspace_id, event_id) WHERE deleted_at IS NULL;
CREATE INDEX guests_phone_idx ON guests (workspace_id, event_id, phone_e164) WHERE deleted_at IS NULL AND phone_e164 IS NOT NULL;

CREATE TABLE event_invitations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL,
  event_id           uuid NOT NULL,
  event_function_id  uuid NOT NULL,
  guest_id           uuid NOT NULL,
  invited_party_size integer NOT NULL CHECK (invited_party_size BETWEEN 1 AND 50),
  token_hash         text NOT NULL UNIQUE,            -- SHA-256 of the RSVP bearer token; plaintext never stored
  token_version      integer NOT NULL DEFAULT 1,      -- bump to rotate (token = HMAC(secret, id, version))
  token_expires_at   timestamptz,
  revoked_at         timestamptz,
  checkin_code_hash  text NOT NULL UNIQUE,            -- SHA-256 of the QR/check-in code
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','responded','expired','revoked')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_function_id, guest_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, event_function_id, id),
  FOREIGN KEY (workspace_id, event_id, event_function_id) REFERENCES event_functions (workspace_id, event_id, id),
  FOREIGN KEY (workspace_id, event_id, guest_id)          REFERENCES guests (workspace_id, event_id, id)
);
CREATE INDEX invitations_function_idx ON event_invitations (event_function_id, status);
CREATE INDEX invitations_guest_idx ON event_invitations (guest_id);

CREATE TABLE rsvp_responses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL,
  invitation_id    uuid NOT NULL UNIQUE,
  status           text NOT NULL CHECK (status IN ('yes','no','maybe')),
  adult_count      integer NOT NULL DEFAULT 0 CHECK (adult_count BETWEEN 0 AND 100),
  child_count      integer NOT NULL DEFAULT 0 CHECK (child_count BETWEEN 0 AND 100),
  version          integer NOT NULL DEFAULT 1,
  responded_at     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_actor_type  text NOT NULL DEFAULT 'guest' CHECK (last_actor_type IN ('guest','organizer','system')),
  override_reason  text,                                -- set only when an authorized organizer exceeded the party cap
  override_by      uuid REFERENCES users(id),
  CHECK (status <> 'yes' OR adult_count + child_count >= 1),
  CHECK (status <> 'no'  OR (adult_count = 0 AND child_count = 0)),
  FOREIGN KEY (workspace_id, invitation_id) REFERENCES event_invitations (workspace_id, id)
);

-- Defense in depth for the party-size cap: the service enforces it first; the database refuses a silent bypass.
CREATE FUNCTION enforce_rsvp_party_cap() RETURNS trigger AS $$
DECLARE cap integer;
BEGIN
  SELECT invited_party_size INTO cap FROM event_invitations WHERE id = NEW.invitation_id;
  IF NEW.adult_count + NEW.child_count > cap AND (NEW.override_reason IS NULL OR NEW.override_by IS NULL) THEN
    RAISE EXCEPTION 'RSVP exceeds invited party size without an authorized override' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rsvp_party_cap_trg BEFORE INSERT OR UPDATE ON rsvp_responses
  FOR EACH ROW EXECUTE FUNCTION enforce_rsvp_party_cap();

CREATE TABLE rsvp_response_history (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL,
  invitation_id        uuid NOT NULL,
  response_version     integer NOT NULL,
  previous_status      text CHECK (previous_status IN ('yes','no','maybe')),
  new_status           text NOT NULL CHECK (new_status IN ('yes','no','maybe')),
  previous_adult_count integer,
  previous_child_count integer,
  new_adult_count      integer NOT NULL,
  new_child_count      integer NOT NULL,
  actor_type           text NOT NULL CHECK (actor_type IN ('guest','organizer','system')),
  actor_id             uuid REFERENCES users(id),
  reason               text,
  is_override          boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, invitation_id) REFERENCES event_invitations (workspace_id, id)
);
CREATE INDEX rsvp_history_invitation_idx ON rsvp_response_history (invitation_id, created_at);
CREATE TRIGGER rsvp_history_append_only BEFORE UPDATE OR DELETE ON rsvp_response_history
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
