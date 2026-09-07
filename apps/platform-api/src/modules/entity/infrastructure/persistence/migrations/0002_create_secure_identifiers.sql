ALTER TABLE entities
  ADD CONSTRAINT entities_id_workspace_uq UNIQUE (id, workspace_id);

CREATE TABLE entity_identifiers (
  id uuid PRIMARY KEY,
  entity_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  identifier_type text NOT NULL CHECK (identifier_type IN (
    'NATIONAL_ID', 'PHONE', 'EMAIL', 'PLATFORM_USER_ID', 'USERNAME',
    'INTERNAL_RESIDENT_ID'
  )),
  classification text NOT NULL CHECK (classification IN (
    'PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED'
  )),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  encrypted_value bytea NOT NULL CHECK (
    octet_length(encrypted_value) BETWEEN 3 AND 320
  ),
  encryption_nonce bytea NOT NULL CHECK (octet_length(encryption_nonce) = 12),
  authentication_tag bytea NOT NULL CHECK (octet_length(authentication_tag) = 16),
  encryption_key_id text NOT NULL CHECK (
    encryption_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  cipher_algorithm text NOT NULL CHECK (cipher_algorithm = 'aes-256-gcm'),
  comparison_fingerprint bytea NOT NULL CHECK (
    octet_length(comparison_fingerprint) = 32
  ),
  fingerprint_key_id text NOT NULL CHECK (
    fingerprint_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  fingerprint_algorithm text NOT NULL CHECK (
    fingerprint_algorithm = 'HMAC-SHA-256'
  ),
  normalization_version smallint NOT NULL CHECK (normalization_version = 1),
  revision integer NOT NULL CHECK (revision > 0),
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT entity_identifiers_entity_workspace_fk
    FOREIGN KEY (entity_id, workspace_id) REFERENCES entities(id, workspace_id),
  CONSTRAINT entity_identifiers_workspace_value_uq UNIQUE (
    workspace_id, identifier_type, fingerprint_key_id, comparison_fingerprint
  )
);
CREATE INDEX entity_identifiers_entity_page_idx
  ON entity_identifiers (entity_id, identifier_type, id);

CREATE TABLE entity_identifier_revisions (
  identifier_id uuid NOT NULL REFERENCES entity_identifiers(id),
  revision integer NOT NULL CHECK (revision > 0),
  entity_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  identifier_type text NOT NULL CHECK (identifier_type IN (
    'NATIONAL_ID', 'PHONE', 'EMAIL', 'PLATFORM_USER_ID', 'USERNAME',
    'INTERNAL_RESIDENT_ID'
  )),
  classification text NOT NULL CHECK (classification IN (
    'PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED'
  )),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  actor_user_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (identifier_id, revision)
);

CREATE TABLE entity_identifier_idempotency (
  user_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  identifier_id uuid NOT NULL REFERENCES entity_identifiers(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE FUNCTION preserve_entity_identifier_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Entity Identifier revision history is append-only';
END;
$$;
CREATE TRIGGER entity_identifier_revisions_append_only
BEFORE UPDATE OR DELETE ON entity_identifier_revisions
FOR EACH ROW EXECUTE FUNCTION preserve_entity_identifier_revision();

CREATE FUNCTION preserve_entity_identifier_protected_value() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_id IS DISTINCT FROM OLD.entity_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.identifier_type IS DISTINCT FROM OLD.identifier_type
    OR NEW.classification IS DISTINCT FROM OLD.classification
    OR NEW.encrypted_value IS DISTINCT FROM OLD.encrypted_value
    OR NEW.encryption_nonce IS DISTINCT FROM OLD.encryption_nonce
    OR NEW.authentication_tag IS DISTINCT FROM OLD.authentication_tag
    OR NEW.encryption_key_id IS DISTINCT FROM OLD.encryption_key_id
    OR NEW.cipher_algorithm IS DISTINCT FROM OLD.cipher_algorithm
    OR NEW.comparison_fingerprint IS DISTINCT FROM OLD.comparison_fingerprint
    OR NEW.fingerprint_key_id IS DISTINCT FROM OLD.fingerprint_key_id
    OR NEW.fingerprint_algorithm IS DISTINCT FROM OLD.fingerprint_algorithm
    OR NEW.normalization_version IS DISTINCT FROM OLD.normalization_version
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Entity Identifier protected value is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER entity_identifier_protected_value_immutable
BEFORE UPDATE ON entity_identifiers
FOR EACH ROW EXECUTE FUNCTION preserve_entity_identifier_protected_value();
