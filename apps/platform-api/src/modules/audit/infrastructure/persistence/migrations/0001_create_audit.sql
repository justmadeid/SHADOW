-- migration-safety: allow-destructive ADR-003
-- The lexical gate sees TRUNCATE below; this only creates a trigger blocking it.
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  version integer NOT NULL CHECK (version = 1),
  operation_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('CASE_MEMBERSHIP_GRANTED', 'CASE_MEMBERSHIP_REVOKED', 'SENSITIVE_FIELD_VIEW', 'SENSITIVE_FIELD_MATCH', 'EVIDENCE_EXPORT_AUTHORIZATION', 'SOURCE_ACCESS_AUTHORIZATION')),
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'AUTHORIZED', 'DENIED')),
  workspace_id uuid NOT NULL,
  case_id uuid,
  resource_type text NOT NULL CHECK (resource_type IN ('WORKSPACE', 'CASE', 'INVESTIGATION', 'ENTITY', 'EVIDENCE', 'IDENTIFIER', 'EXPORT', 'GOVERNANCE')),
  resource_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('USER', 'SERVICE')),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 255),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 128),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  classification text CHECK (classification IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')),
  membership_id uuid,
  resource_revision integer CHECK (resource_revision > 0),
  occurred_at timestamptz NOT NULL,
  UNIQUE (workspace_id, operation_id, action, outcome),
  CHECK (resource_type <> 'CASE' OR (case_id IS NOT NULL AND case_id = resource_id)),
  CHECK ((action IN ('CASE_MEMBERSHIP_GRANTED', 'CASE_MEMBERSHIP_REVOKED') AND outcome = 'SUCCEEDED' AND resource_type = 'CASE' AND membership_id IS NOT NULL AND resource_revision IS NOT NULL AND reason IS NOT NULL)
    OR (action NOT IN ('CASE_MEMBERSHIP_GRANTED', 'CASE_MEMBERSHIP_REVOKED') AND outcome IN ('AUTHORIZED', 'DENIED') AND classification IS NOT NULL AND membership_id IS NULL))
);
-- No cascading domain FK: evidence of actions must survive resource lifecycle changes.
CREATE INDEX audit_events_workspace_time_idx ON audit_events (workspace_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_case_time_idx ON audit_events (workspace_id, case_id, occurred_at DESC, id DESC);
CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;
