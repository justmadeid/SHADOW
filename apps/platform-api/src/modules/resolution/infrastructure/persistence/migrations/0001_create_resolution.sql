CREATE UNIQUE INDEX investigation_subjects_resolution_scope_uq
  ON investigation_subjects (id, workspace_id, case_id);

CREATE TABLE resolution_sessions (
  id uuid PRIMARY KEY,
  subject_id uuid NOT NULL REFERENCES investigation_subjects(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  status text NOT NULL CHECK (status IN ('SEARCHING', 'NEEDS_REVIEW', 'RESOLVED', 'CLOSED')),
  candidates_count integer NOT NULL DEFAULT 0 CHECK (candidates_count >= 0),
  selected_candidate_id uuid,
  resolution_decision_id uuid,
  revision integer NOT NULL CHECK (revision > 0),
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  CONSTRAINT resolution_session_terminal_shape CHECK (
    (status = 'RESOLVED' AND selected_candidate_id IS NOT NULL AND resolution_decision_id IS NOT NULL)
    OR (status = 'CLOSED')
    OR (status IN ('SEARCHING', 'NEEDS_REVIEW') AND selected_candidate_id IS NULL AND resolution_decision_id IS NULL)
  ),
  CONSTRAINT resolution_session_subject_scope_fk
    FOREIGN KEY (subject_id, workspace_id, case_id)
    REFERENCES investigation_subjects(id, workspace_id, case_id)
);
CREATE INDEX resolution_sessions_subject_page_idx
  ON resolution_sessions (workspace_id, case_id, subject_id, id DESC);
CREATE UNIQUE INDEX resolution_sessions_subject_active_uq
  ON resolution_sessions (subject_id)
  WHERE status IN ('SEARCHING', 'NEEDS_REVIEW');
CREATE UNIQUE INDEX resolution_sessions_candidate_scope_uq
  ON resolution_sessions (id, subject_id, workspace_id, case_id);

CREATE TABLE candidates (
  id uuid PRIMARY KEY,
  resolution_session_id uuid NOT NULL REFERENCES resolution_sessions(id),
  subject_id uuid NOT NULL REFERENCES investigation_subjects(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  candidate_type text NOT NULL CHECK (candidate_type IN ('PERSON', 'ORGANIZATION', 'SOCIAL_ACCOUNT', 'DOMAIN')),
  status text NOT NULL CHECK (status IN ('PENDING_REVIEW', 'RESOLVED', 'REJECTED', 'UNCERTAIN')),
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 1 AND 200),
  classification text NOT NULL CHECK (classification IN ('PUBLIC', 'INTERNAL', 'SENSITIVE')),
  source_origin text NOT NULL CHECK (source_origin IN (
    'INVESTIGATOR_INPUT', 'SOURCE_RECORD', 'EVIDENCE', 'RUN', 'ANALYSIS_EXTRACTION', 'IMPORT'
  )),
  source_resource_type text CHECK (source_resource_type IN ('SOURCE_RECORD', 'EVIDENCE', 'RUN', 'ANALYSIS')),
  source_resource_id uuid,
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  CONSTRAINT candidate_resolution_scope_fk
    FOREIGN KEY (resolution_session_id, subject_id, workspace_id, case_id)
    REFERENCES resolution_sessions(id, subject_id, workspace_id, case_id),
  CONSTRAINT candidate_source_shape CHECK (
    (source_origin = 'INVESTIGATOR_INPUT' AND source_resource_type IS NULL AND source_resource_id IS NULL)
    OR (source_origin IN ('SOURCE_RECORD', 'IMPORT') AND source_resource_type = 'SOURCE_RECORD' AND source_resource_id IS NOT NULL)
    OR (source_origin = 'EVIDENCE' AND source_resource_type = 'EVIDENCE' AND source_resource_id IS NOT NULL)
    OR (source_origin = 'RUN' AND source_resource_type = 'RUN' AND source_resource_id IS NOT NULL)
    OR (source_origin = 'ANALYSIS_EXTRACTION' AND source_resource_type = 'ANALYSIS' AND source_resource_id IS NOT NULL)
  )
);
CREATE INDEX candidates_session_page_idx ON candidates (resolution_session_id, id DESC);
CREATE INDEX candidates_subject_idx ON candidates (subject_id, id DESC);
CREATE UNIQUE INDEX candidates_evidence_scope_uq
  ON candidates (id, workspace_id, case_id);
CREATE UNIQUE INDEX candidates_resolution_scope_uq
  ON candidates (id, resolution_session_id);

CREATE TABLE candidate_evidence_refs (
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  evidence_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  PRIMARY KEY (candidate_id, ordinal),
  CONSTRAINT candidate_evidence_ref_uq UNIQUE (candidate_id, evidence_id),
  CONSTRAINT candidate_evidence_scope_fk
    FOREIGN KEY (candidate_id, workspace_id, case_id)
    REFERENCES candidates(id, workspace_id, case_id)
);

CREATE TABLE resolution_decisions (
  id uuid PRIMARY KEY,
  resolution_session_id uuid NOT NULL REFERENCES resolution_sessions(id),
  candidate_id uuid NOT NULL UNIQUE REFERENCES candidates(id),
  decision text NOT NULL CHECK (decision IN ('LINK_EXISTING', 'CREATE_NEW', 'UNCERTAIN', 'REJECT')),
  target_entity_id uuid REFERENCES entities(id),
  reason_code text NOT NULL CHECK (reason_code IN (
    'EXACT_IDENTIFIER_MATCH', 'MULTIPLE_SUPPORTING_SIGNALS', 'INSUFFICIENT_EVIDENCE',
    'CONFLICTING_SIGNALS', 'NOT_SAME_IDENTITY', 'MANUAL_REVIEW'
  )),
  decided_by_user_id text NOT NULL,
  decided_at timestamptz NOT NULL,
  CONSTRAINT resolution_decision_candidate_scope_fk
    FOREIGN KEY (candidate_id, resolution_session_id)
    REFERENCES candidates(id, resolution_session_id),
  CONSTRAINT resolution_decision_target_shape CHECK (
    (decision IN ('LINK_EXISTING', 'CREATE_NEW') AND target_entity_id IS NOT NULL)
    OR (decision IN ('UNCERTAIN', 'REJECT') AND target_entity_id IS NULL)
  )
);
CREATE INDEX resolution_decisions_session_time_idx
  ON resolution_decisions (resolution_session_id, decided_at, id);

ALTER TABLE resolution_sessions
  ADD CONSTRAINT resolution_sessions_selected_candidate_fk
  FOREIGN KEY (selected_candidate_id) REFERENCES candidates(id);
ALTER TABLE resolution_sessions
  ADD CONSTRAINT resolution_sessions_decision_fk
  FOREIGN KEY (resolution_decision_id) REFERENCES resolution_decisions(id);

CREATE TABLE resolution_session_revisions (
  resolution_session_id uuid NOT NULL REFERENCES resolution_sessions(id),
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('SEARCHING', 'NEEDS_REVIEW', 'RESOLVED', 'CLOSED')),
  candidates_count integer NOT NULL CHECK (candidates_count >= 0),
  selected_candidate_id uuid,
  resolution_decision_id uuid,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (resolution_session_id, revision)
);

CREATE TABLE candidate_revisions (
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('PENDING_REVIEW', 'RESOLVED', 'REJECTED', 'UNCERTAIN')),
  actor_type text NOT NULL CHECK (actor_type IN ('USER', 'SERVICE')),
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (candidate_id, revision)
);

CREATE TABLE resolution_session_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL,
  resolution_session_id uuid NOT NULL REFERENCES resolution_sessions(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE candidate_idempotency (
  producer_type text NOT NULL CHECK (producer_type IN ('USER', 'SERVICE')),
  producer_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  candidate_id uuid NOT NULL UNIQUE REFERENCES candidates(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (producer_type, producer_id, idempotency_key)
);

CREATE FUNCTION preserve_resolution_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subject_id IS DISTINCT FROM OLD.subject_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'ResolutionSession identity and scope are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION preserve_candidate_identity_and_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resolution_session_id IS DISTINCT FROM OLD.resolution_session_id
    OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id
    OR NEW.candidate_type IS DISTINCT FROM OLD.candidate_type
    OR NEW.display_label IS DISTINCT FROM OLD.display_label
    OR NEW.classification IS DISTINCT FROM OLD.classification
    OR NEW.source_origin IS DISTINCT FROM OLD.source_origin
    OR NEW.source_resource_type IS DISTINCT FROM OLD.source_resource_type
    OR NEW.source_resource_id IS DISTINCT FROM OLD.source_resource_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Candidate identity and provenance are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER resolution_sessions_identity_immutable
BEFORE UPDATE ON resolution_sessions
FOR EACH ROW EXECUTE FUNCTION preserve_resolution_session_identity();
CREATE TRIGGER candidates_identity_provenance_immutable
BEFORE UPDATE ON candidates
FOR EACH ROW EXECUTE FUNCTION preserve_candidate_identity_and_provenance();

CREATE FUNCTION preserve_resolution_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Resolution history and source linkage are append-only';
END;
$$;
CREATE TRIGGER resolution_session_revisions_append_only
BEFORE UPDATE OR DELETE ON resolution_session_revisions
FOR EACH ROW EXECUTE FUNCTION preserve_resolution_history();
CREATE TRIGGER candidate_revisions_append_only
BEFORE UPDATE OR DELETE ON candidate_revisions
FOR EACH ROW EXECUTE FUNCTION preserve_resolution_history();
CREATE TRIGGER candidate_evidence_refs_append_only
BEFORE UPDATE OR DELETE ON candidate_evidence_refs
FOR EACH ROW EXECUTE FUNCTION preserve_resolution_history();
CREATE TRIGGER resolution_decisions_append_only
BEFORE UPDATE OR DELETE ON resolution_decisions
FOR EACH ROW EXECUTE FUNCTION preserve_resolution_history();
