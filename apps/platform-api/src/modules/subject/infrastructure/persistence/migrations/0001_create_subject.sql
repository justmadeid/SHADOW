CREATE TABLE investigation_subjects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  investigation_id uuid REFERENCES investigations(id),
  subject_type text NOT NULL CHECK (subject_type IN ('PERSON', 'ORGANIZATION', 'SOCIAL_ACCOUNT', 'DOMAIN', 'UNKNOWN')),
  role text NOT NULL CHECK (role IN ('PRIMARY_TARGET', 'SECONDARY_TARGET', 'PERSON_OF_INTEREST', 'RELATED_PERSON', 'WITNESS', 'UNKNOWN')),
  -- Resolution persistence is intentionally unavailable until Registry validation
  -- and atomic decision coordination are implemented (P2-003/P2-008).
  status text NOT NULL CHECK (status IN ('UNRESOLVED', 'ARCHIVED')),
  revision integer NOT NULL CHECK (revision > 0),
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at)
);
CREATE INDEX investigation_subjects_case_page_idx ON investigation_subjects (workspace_id, case_id, id DESC);
CREATE INDEX investigation_subjects_case_idx ON investigation_subjects (case_id);
CREATE INDEX investigation_subjects_investigation_idx ON investigation_subjects (investigation_id) WHERE investigation_id IS NOT NULL;

CREATE TABLE subject_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  subject_id uuid NOT NULL UNIQUE REFERENCES investigation_subjects(id),
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE subject_revisions (
  subject_id uuid NOT NULL REFERENCES investigation_subjects(id),
  revision integer NOT NULL CHECK (revision > 0),
  role text NOT NULL CHECK (role IN ('PRIMARY_TARGET', 'SECONDARY_TARGET', 'PERSON_OF_INTEREST', 'RELATED_PERSON', 'WITNESS', 'UNKNOWN')),
  status text NOT NULL CHECK (status IN ('UNRESOLVED', 'ARCHIVED')),
  actor_user_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (subject_id, revision)
);

CREATE FUNCTION preserve_subject_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Subject revision history is append-only';
END;
$$;
CREATE TRIGGER subject_revisions_append_only
BEFORE UPDATE OR DELETE ON subject_revisions
FOR EACH ROW EXECUTE FUNCTION preserve_subject_revision();
