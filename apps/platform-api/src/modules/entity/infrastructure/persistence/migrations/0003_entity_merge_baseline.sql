-- migration-safety: allow-destructive ADR-015
-- DELETE/TRUNCATE appear only in protection triggers and privilege revocation.
CREATE INDEX entities_merge_target_idx
  ON entities (merged_into_id) WHERE merged_into_id IS NOT NULL;

CREATE TABLE entity_merges (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  survivor_entity_id uuid NOT NULL,
  absorbed_entity_id uuid NOT NULL,
  survivor_revision_before integer NOT NULL CHECK (survivor_revision_before > 0),
  survivor_revision_after integer NOT NULL CHECK (
    survivor_revision_after = survivor_revision_before + 1
  ),
  absorbed_revision_before integer NOT NULL CHECK (absorbed_revision_before > 0),
  absorbed_revision_after integer NOT NULL CHECK (
    absorbed_revision_after = absorbed_revision_before + 1
  ),
  reason_code text NOT NULL CHECK (reason_code IN (
    'DUPLICATE_IDENTITY', 'EXACT_IDENTIFIER_MATCH',
    'MULTIPLE_SUPPORTING_SIGNALS', 'DATA_CORRECTION', 'MANUAL_REVIEW'
  )),
  actor_user_id text NOT NULL CHECK (char_length(actor_user_id) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL,
  CONSTRAINT entity_merges_distinct_entities CHECK (
    survivor_entity_id <> absorbed_entity_id
  ),
  CONSTRAINT entity_merges_survivor_workspace_fk
    FOREIGN KEY (survivor_entity_id, workspace_id) REFERENCES entities(id, workspace_id),
  CONSTRAINT entity_merges_absorbed_workspace_fk
    FOREIGN KEY (absorbed_entity_id, workspace_id) REFERENCES entities(id, workspace_id),
  CONSTRAINT entity_merges_operation_uq UNIQUE (workspace_id, operation_id)
);
CREATE INDEX entity_merges_survivor_time_idx
  ON entity_merges (survivor_entity_id, created_at DESC, id DESC);
CREATE INDEX entity_merges_absorbed_time_idx
  ON entity_merges (absorbed_entity_id, created_at DESC, id DESC);

CREATE TABLE entity_merge_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  merge_id uuid NOT NULL UNIQUE REFERENCES entity_merges(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE FUNCTION preserve_entity_merge_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Entity merge history is append-only';
END;
$$;
CREATE TRIGGER entity_merges_append_only BEFORE UPDATE OR DELETE ON entity_merges
FOR EACH ROW EXECUTE FUNCTION preserve_entity_merge_history();
CREATE TRIGGER entity_merges_no_truncate BEFORE TRUNCATE ON entity_merges
FOR EACH STATEMENT EXECUTE FUNCTION preserve_entity_merge_history();
REVOKE UPDATE, DELETE, TRUNCATE ON entity_merges FROM PUBLIC;
