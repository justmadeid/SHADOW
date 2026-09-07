CREATE TABLE entities (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  entity_type text NOT NULL CHECK (entity_type IN (
    'PERSON', 'ORGANIZATION', 'SOCIAL_ACCOUNT', 'EMAIL_ADDRESS', 'PHONE_NUMBER',
    'LOCATION', 'ADDRESS', 'DOMAIN', 'WEBSITE', 'IP_ADDRESS', 'VEHICLE', 'DEVICE',
    'DOCUMENT', 'EVENT'
  )),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'MERGED', 'ARCHIVED')),
  canonical_label text NOT NULL CHECK (char_length(canonical_label) BETWEEN 1 AND 200),
  canonical_label_normalized text NOT NULL CHECK (char_length(canonical_label_normalized) BETWEEN 1 AND 400),
  merged_into_id uuid REFERENCES entities(id),
  revision integer NOT NULL CHECK (revision > 0),
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT entities_merge_shape CHECK (
    (status = 'MERGED' AND merged_into_id IS NOT NULL AND merged_into_id <> id)
    OR (status <> 'MERGED' AND merged_into_id IS NULL)
  )
);
CREATE INDEX entities_workspace_page_idx ON entities (workspace_id, id DESC);
CREATE INDEX entities_workspace_label_idx ON entities (workspace_id, canonical_label_normalized);

CREATE TABLE entity_aliases (
  id uuid PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES entities(id),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  normalized_label text NOT NULL CHECK (char_length(normalized_label) BETWEEN 1 AND 400),
  revision_added integer NOT NULL CHECK (revision_added > 0),
  created_at timestamptz NOT NULL,
  CONSTRAINT entity_aliases_entity_label_uq UNIQUE (entity_id, normalized_label)
);
CREATE INDEX entity_aliases_lookup_idx ON entity_aliases (normalized_label, entity_id);

CREATE TABLE entity_revisions (
  entity_id uuid NOT NULL REFERENCES entities(id),
  revision integer NOT NULL CHECK (revision > 0),
  entity_type text NOT NULL CHECK (entity_type IN (
    'PERSON', 'ORGANIZATION', 'SOCIAL_ACCOUNT', 'EMAIL_ADDRESS', 'PHONE_NUMBER',
    'LOCATION', 'ADDRESS', 'DOMAIN', 'WEBSITE', 'IP_ADDRESS', 'VEHICLE', 'DEVICE',
    'DOCUMENT', 'EVENT'
  )),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'MERGED', 'ARCHIVED')),
  canonical_label text NOT NULL CHECK (char_length(canonical_label) BETWEEN 1 AND 200),
  merged_into_id uuid,
  actor_user_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (entity_id, revision)
);

CREATE TABLE entity_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  entity_id uuid NOT NULL REFERENCES entities(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE FUNCTION preserve_entity_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Entity revision history is append-only';
END;
$$;
CREATE TRIGGER entity_revisions_append_only BEFORE UPDATE OR DELETE ON entity_revisions
FOR EACH ROW EXECUTE FUNCTION preserve_entity_revision();
CREATE TRIGGER entity_aliases_append_only BEFORE UPDATE OR DELETE ON entity_aliases
FOR EACH ROW EXECUTE FUNCTION preserve_entity_revision();
