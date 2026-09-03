CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
  slug text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT workspaces_slug_uq UNIQUE (slug)
);

CREATE TABLE workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  locale text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE workspace_members (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REMOVED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  joined_at timestamptz NOT NULL,
  removed_at timestamptz,
  CONSTRAINT workspace_members_workspace_user_uq UNIQUE (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_status_idx
  ON workspace_members (user_id, status);

CREATE TABLE workspace_membership_history (
  id uuid PRIMARY KEY,
  workspace_member_id uuid NOT NULL REFERENCES workspace_members(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('ADDED', 'REMOVED')),
  actor_user_id text NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX workspace_membership_history_workspace_time_idx
  ON workspace_membership_history (workspace_id, occurred_at);

CREATE TABLE workspace_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);
