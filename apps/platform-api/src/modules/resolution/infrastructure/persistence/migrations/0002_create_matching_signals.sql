-- migration-safety: allow-destructive ADR-011

ALTER TABLE candidates DROP CONSTRAINT candidates_classification_check;
ALTER TABLE candidates
  ADD CONSTRAINT candidates_classification_check
  CHECK (classification IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED'));
ALTER TABLE candidates
  ADD CONSTRAINT candidates_restricted_label_check
  CHECK (classification <> 'RESTRICTED' OR display_label = 'Restricted candidate');
ALTER TABLE candidates
  ADD CONSTRAINT candidates_match_scope_uq
  UNIQUE (id, resolution_session_id, workspace_id, case_id);

CREATE TABLE resolution_entity_matches (
  id uuid PRIMARY KEY,
  resolution_session_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision > 0),
  entity_id uuid NOT NULL,
  entity_revision integer NOT NULL CHECK (entity_revision > 0),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  match_level text NOT NULL CHECK (match_level IN ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH')),
  policy_version smallint NOT NULL CHECK (policy_version = 1),
  producer_type text NOT NULL CHECK (producer_type IN ('USER', 'SERVICE')),
  producer_id text NOT NULL CHECK (char_length(producer_id) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL,
  CONSTRAINT resolution_entity_match_candidate_scope_fk
    FOREIGN KEY (candidate_id, resolution_session_id, workspace_id, case_id)
    REFERENCES candidates(id, resolution_session_id, workspace_id, case_id),
  CONSTRAINT resolution_entity_match_entity_scope_fk
    FOREIGN KEY (entity_id, workspace_id)
    REFERENCES entities(id, workspace_id),
  CONSTRAINT resolution_entity_match_snapshot_uq UNIQUE (
    candidate_id, entity_id, candidate_revision, entity_revision, policy_version
  )
);
CREATE INDEX resolution_entity_matches_session_page_idx
  ON resolution_entity_matches (resolution_session_id, id DESC);

CREATE TABLE resolution_match_signals (
  id uuid NOT NULL UNIQUE,
  entity_match_id uuid NOT NULL REFERENCES resolution_entity_matches(id),
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 49),
  signal_kind text NOT NULL CHECK (signal_kind IN ('MATCHING', 'CONFLICT')),
  signal_field text NOT NULL CHECK (signal_field IN (
    'NATIONAL_ID', 'PHONE', 'EMAIL', 'PLATFORM_USER_ID', 'USERNAME',
    'INTERNAL_RESIDENT_ID', 'NAME', 'DATE_OF_BIRTH', 'DOMAIN', 'ACCOUNT_HANDLE'
  )),
  result text NOT NULL CHECK (result IN (
    'EXACT_MATCH', 'PARTIAL_MATCH', 'NO_MATCH', 'CONFLICT'
  )),
  strength text NOT NULL CHECK (strength IN (
    'WEAK', 'SUPPORTING', 'STRONG', 'CONTRADICTING'
  )),
  classification text NOT NULL CHECK (classification IN (
    'PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED'
  )),
  value_visibility text NOT NULL CHECK (value_visibility IN (
    'FULL', 'MASKED', 'MATCH_ONLY', 'HIDDEN'
  )),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (entity_match_id, ordinal),
  CONSTRAINT resolution_match_signal_semantics CHECK (
    (signal_kind = 'MATCHING'
      AND result IN ('EXACT_MATCH', 'PARTIAL_MATCH')
      AND strength IN ('WEAK', 'SUPPORTING', 'STRONG'))
    OR (signal_kind = 'CONFLICT'
      AND result IN ('NO_MATCH', 'CONFLICT')
      AND strength = 'CONTRADICTING')
  ),
  CONSTRAINT resolution_match_signal_sensitive_visibility CHECK (
    classification NOT IN ('SENSITIVE', 'RESTRICTED')
    OR value_visibility IN ('MATCH_ONLY', 'HIDDEN')
  )
);

CREATE TABLE resolution_entity_match_idempotency (
  producer_type text NOT NULL CHECK (producer_type IN ('USER', 'SERVICE')),
  producer_id text NOT NULL CHECK (char_length(producer_id) BETWEEN 1 AND 255),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  entity_match_id uuid NOT NULL REFERENCES resolution_entity_matches(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (producer_type, producer_id, idempotency_key)
);

CREATE TRIGGER resolution_entity_matches_append_only
BEFORE UPDATE OR DELETE ON resolution_entity_matches
FOR EACH ROW EXECUTE FUNCTION preserve_resolution_history();
CREATE TRIGGER resolution_match_signals_append_only
BEFORE UPDATE OR DELETE ON resolution_match_signals
FOR EACH ROW EXECUTE FUNCTION preserve_resolution_history();
