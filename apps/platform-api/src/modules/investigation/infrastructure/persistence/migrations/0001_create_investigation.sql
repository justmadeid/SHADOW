CREATE TABLE investigations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  objective text NOT NULL CHECK (char_length(objective) BETWEEN 3 AND 2000),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  archived_at timestamptz
);

CREATE INDEX investigations_case_updated_idx
  ON investigations (case_id, updated_at DESC, id DESC);

CREATE INDEX investigations_workspace_case_idx
  ON investigations (workspace_id, case_id);

CREATE TABLE investigation_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key),
  CONSTRAINT investigation_idempotency_investigation_uq UNIQUE (investigation_id)
);
