ALTER TABLE resolution_decisions
  ADD COLUMN workspace_id uuid;

UPDATE resolution_decisions d
SET workspace_id = c.workspace_id
FROM candidates c
WHERE c.id = d.candidate_id;

ALTER TABLE resolution_decisions
  ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT resolution_decisions_entity_scope_fk
    FOREIGN KEY (target_entity_id, workspace_id) REFERENCES entities(id, workspace_id);

CREATE TABLE candidate_resolution_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  decision_id uuid NOT NULL UNIQUE REFERENCES resolution_decisions(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);
