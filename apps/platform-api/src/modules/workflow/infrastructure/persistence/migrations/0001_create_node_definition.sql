CREATE TABLE node_definitions (
  id uuid PRIMARY KEY,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,63}$'),
  version integer NOT NULL CHECK (version > 0),
  category text NOT NULL CHECK (category IN ('COLLECTION', 'ENRICHMENT', 'ANALYSIS')),
  capability text NOT NULL CHECK (capability ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  inputs jsonb NOT NULL,
  outputs jsonb NOT NULL,
  config_schema jsonb NOT NULL,
  execution_policy jsonb NOT NULL,
  review_policy jsonb NOT NULL,
  required_permission text NOT NULL,
  presentation jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DEPRECATED')),
  created_at timestamptz NOT NULL,
  CONSTRAINT node_definitions_key_version_uq UNIQUE (key, version)
);

CREATE INDEX node_definitions_key_idx ON node_definitions (key, version DESC);
CREATE INDEX node_definitions_status_key_idx ON node_definitions (status, key, version DESC);
