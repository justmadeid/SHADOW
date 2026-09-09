CREATE TABLE execution_attempts (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_identity text NOT NULL,
  lease_owner text NOT NULL,
  lease_duration_seconds integer NOT NULL CHECK (lease_duration_seconds BETWEEN 1 AND 300),
  leased_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'LOST')),
  error_code text,
  retryable boolean,
  -- {stage, processed, produced, total}; total stays nullable and is never
  -- used to derive a percentage (see ADR-020 / Execution Gate).
  last_progress jsonb,
  started_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  completed_at timestamptz,
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (run_id, attempt_number)
);

CREATE INDEX execution_attempts_run_idx ON execution_attempts (run_id, attempt_number DESC);
CREATE INDEX execution_attempts_active_idx
  ON execution_attempts (run_id, leased_until)
  WHERE status IN ('LEASED', 'RUNNING');

-- No append-only history sub-table: ExecutionAttempt is an ephemeral
-- execution record, not a business identity/knowledge record subject to the
-- Audit Gate / Rule 10 provenance requirements (see ADR-020). A plain
-- revision column with compare-and-set on the state-changing calls
-- (progress excepted) is sufficient.

CREATE TABLE execution_attempt_idempotency (
  worker_identity text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  attempt_id uuid NOT NULL UNIQUE REFERENCES execution_attempts(id),
  PRIMARY KEY (worker_identity, idempotency_key)
);
