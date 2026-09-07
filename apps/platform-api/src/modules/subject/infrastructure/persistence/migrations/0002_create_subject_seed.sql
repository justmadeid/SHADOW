CREATE TABLE subject_seeds (
  id uuid PRIMARY KEY,
  subject_id uuid NOT NULL UNIQUE REFERENCES investigation_subjects(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE subject_seed_fields (
  id uuid PRIMARY KEY,
  seed_id uuid NOT NULL REFERENCES subject_seeds(id),
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  field_name text NOT NULL CHECK (field_name IN ('DISPLAY_NAME', 'ORGANIZATION_NAME', 'USERNAME', 'DOMAIN_NAME', 'LOCATION_TEXT', 'SOCIAL_PROFILE_URL')),
  value_text text NOT NULL CHECK (char_length(value_text) BETWEEN 1 AND 2000),
  origin text NOT NULL CHECK (origin IN ('INVESTIGATOR_INPUT', 'SOURCE_RECORD', 'EVIDENCE', 'ANALYSIS_EXTRACTION', 'IMPORT')),
  classification text NOT NULL CHECK (classification IN ('PUBLIC', 'INTERNAL', 'SENSITIVE')),
  evidence_id uuid,
  source_record_id uuid,
  CONSTRAINT subject_seed_fields_position_uq UNIQUE (seed_id, ordinal),
  CONSTRAINT subject_seed_fields_name_uq UNIQUE (seed_id, field_name),
  CONSTRAINT subject_seed_fields_provenance_shape CHECK (
    (origin = 'INVESTIGATOR_INPUT' AND evidence_id IS NULL AND source_record_id IS NULL)
    OR (origin IN ('EVIDENCE', 'ANALYSIS_EXTRACTION') AND evidence_id IS NOT NULL AND source_record_id IS NULL)
    OR (origin IN ('SOURCE_RECORD', 'IMPORT') AND evidence_id IS NULL AND source_record_id IS NOT NULL)
  )
);
CREATE INDEX subject_seeds_scope_idx ON subject_seeds (workspace_id, case_id, subject_id);
CREATE INDEX subject_seed_fields_seed_idx ON subject_seed_fields (seed_id, ordinal);

CREATE FUNCTION preserve_subject_seed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Subject seed provenance is append-only';
END;
$$;
CREATE TRIGGER subject_seeds_append_only BEFORE UPDATE OR DELETE ON subject_seeds
FOR EACH ROW EXECUTE FUNCTION preserve_subject_seed();
CREATE TRIGGER subject_seed_fields_append_only BEFORE UPDATE OR DELETE ON subject_seed_fields
FOR EACH ROW EXECUTE FUNCTION preserve_subject_seed();
