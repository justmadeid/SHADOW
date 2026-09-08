CREATE TABLE runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  node_instance_id uuid NOT NULL REFERENCES node_instances(id),
  node_definition_key text NOT NULL,
  node_definition_version integer NOT NULL,
  -- Frozen structural copy of NodeInstance configuration/InputBindings at
  -- Run-creation time. Not a live-resolved value snapshot (see ADR-019).
  input_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')),
  trigger text NOT NULL CHECK (trigger IN ('MANUAL')),
  triggered_by_user_id text NOT NULL,
  parent_run_id uuid REFERENCES runs(id),
  retry_of uuid REFERENCES runs(id),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX runs_case_created_idx ON runs (workspace_id, case_id, created_at DESC, id DESC);
CREATE INDEX runs_node_instance_idx ON runs (node_instance_id);
CREATE INDEX runs_retry_of_idx ON runs (retry_of) WHERE retry_of IS NOT NULL;

CREATE TABLE run_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  run_id uuid NOT NULL UNIQUE REFERENCES runs(id),
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE run_revisions (
  run_id uuid NOT NULL REFERENCES runs(id),
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')),
  actor_user_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, revision)
);

CREATE FUNCTION preserve_run_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Run revision history is append-only';
END;
$$;
CREATE TRIGGER run_revisions_append_only
BEFORE UPDATE OR DELETE ON run_revisions
FOR EACH ROW EXECUTE FUNCTION preserve_run_revision();
