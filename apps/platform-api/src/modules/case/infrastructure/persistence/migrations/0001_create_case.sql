CREATE TABLE cases (
  id uuid PRIMARY KEY,
  code text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description text CHECK (description IS NULL OR char_length(description) <= 4000),
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED')),
  classification text NOT NULL CHECK (
    classification IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')
  ),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz,
  archived_at timestamptz,
  CONSTRAINT cases_code_uq UNIQUE (code)
);

CREATE INDEX cases_workspace_updated_idx
  ON cases (workspace_id, updated_at DESC, id DESC);

CREATE INDEX cases_workspace_status_idx
  ON cases (workspace_id, status);

CREATE TABLE case_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  case_id uuid NOT NULL REFERENCES cases(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);
