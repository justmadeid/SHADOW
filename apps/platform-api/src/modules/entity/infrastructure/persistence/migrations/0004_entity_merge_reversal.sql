-- migration-safety: allow-destructive ADR-016
-- DELETE/TRUNCATE appear only in protection triggers and privilege revocation.
CREATE UNIQUE INDEX entity_merges_reversal_identity_uq
  ON entity_merges (id, workspace_id, survivor_entity_id, absorbed_entity_id);

CREATE TABLE entity_merge_reversals (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  merge_id uuid NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  survivor_entity_id uuid NOT NULL,
  restored_entity_id uuid NOT NULL,
  survivor_revision_before integer NOT NULL CHECK (survivor_revision_before > 0),
  survivor_revision_after integer NOT NULL CHECK (
    survivor_revision_after = survivor_revision_before + 1
  ),
  restored_revision_before integer NOT NULL CHECK (restored_revision_before > 0),
  restored_revision_after integer NOT NULL CHECK (
    restored_revision_after = restored_revision_before + 1
  ),
  reason_code text NOT NULL CHECK (reason_code IN (
    'INCORRECT_IDENTITY_MATCH', 'INSUFFICIENT_EVIDENCE',
    'WRONG_SURVIVOR_SELECTED', 'DATA_CORRECTION', 'MANUAL_REVIEW'
  )),
  actor_user_id text NOT NULL CHECK (char_length(actor_user_id) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL,
  CONSTRAINT entity_merge_reversals_distinct_entities CHECK (
    survivor_entity_id <> restored_entity_id
  ),
  CONSTRAINT entity_merge_reversals_merge_identity_fk
    FOREIGN KEY (merge_id, workspace_id, survivor_entity_id, restored_entity_id)
    REFERENCES entity_merges (
      id, workspace_id, survivor_entity_id, absorbed_entity_id
    ),
  CONSTRAINT entity_merge_reversals_survivor_workspace_fk
    FOREIGN KEY (survivor_entity_id, workspace_id) REFERENCES entities(id, workspace_id),
  CONSTRAINT entity_merge_reversals_restored_workspace_fk
    FOREIGN KEY (restored_entity_id, workspace_id) REFERENCES entities(id, workspace_id),
  CONSTRAINT entity_merge_reversals_operation_uq UNIQUE (workspace_id, operation_id)
);
CREATE INDEX entity_merge_reversals_time_idx
  ON entity_merge_reversals (workspace_id, created_at DESC, id DESC);

CREATE TABLE entity_merge_reversal_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  reversal_id uuid NOT NULL UNIQUE REFERENCES entity_merge_reversals(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TRIGGER entity_merge_reversals_append_only
BEFORE UPDATE OR DELETE ON entity_merge_reversals
FOR EACH ROW EXECUTE FUNCTION preserve_entity_merge_history();
CREATE TRIGGER entity_merge_reversals_no_truncate
BEFORE TRUNCATE ON entity_merge_reversals
FOR EACH STATEMENT EXECUTE FUNCTION preserve_entity_merge_history();
REVOKE UPDATE, DELETE, TRUNCATE ON entity_merge_reversals FROM PUBLIC;
