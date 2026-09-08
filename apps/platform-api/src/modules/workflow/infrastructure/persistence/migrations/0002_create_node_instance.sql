CREATE TABLE node_instances (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  node_definition_key text NOT NULL,
  node_definition_version integer NOT NULL,
  configuration jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'READY', 'ARCHIVED')),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  archived_at timestamptz,
  FOREIGN KEY (node_definition_key, node_definition_version)
    REFERENCES node_definitions (key, version)
);

CREATE INDEX node_instances_investigation_idx ON node_instances (investigation_id);
CREATE INDEX node_instances_case_idx ON node_instances (workspace_id, case_id);

CREATE TABLE node_instance_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  node_instance_id uuid NOT NULL UNIQUE REFERENCES node_instances(id),
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE node_instance_input_bindings (
  node_instance_id uuid NOT NULL REFERENCES node_instances(id),
  target_input text NOT NULL,
  source_expression text NOT NULL CHECK (char_length(source_expression) BETWEEN 1 AND 200),
  source_type text NOT NULL CHECK (source_type IN ('STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'IDENTIFIER', 'RESOURCE_REF')),
  source_classification text CHECK (source_classification IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')),
  PRIMARY KEY (node_instance_id, target_input)
);

CREATE TABLE node_instance_revisions (
  node_instance_id uuid NOT NULL REFERENCES node_instances(id),
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'READY', 'ARCHIVED')),
  configuration_hash text NOT NULL,
  actor_user_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (node_instance_id, revision)
);

CREATE FUNCTION preserve_node_instance_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'NodeInstance revision history is append-only';
END;
$$;
CREATE TRIGGER node_instance_revisions_append_only
BEFORE UPDATE OR DELETE ON node_instance_revisions
FOR EACH ROW EXECUTE FUNCTION preserve_node_instance_revision();

CREATE TABLE workflow_edges (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  from_node_instance_id uuid NOT NULL REFERENCES node_instances(id),
  to_node_instance_id uuid NOT NULL REFERENCES node_instances(id),
  created_at timestamptz NOT NULL,
  CHECK (from_node_instance_id <> to_node_instance_id),
  CONSTRAINT workflow_edges_unique UNIQUE (investigation_id, from_node_instance_id, to_node_instance_id)
);

CREATE INDEX workflow_edges_investigation_idx ON workflow_edges (investigation_id);
