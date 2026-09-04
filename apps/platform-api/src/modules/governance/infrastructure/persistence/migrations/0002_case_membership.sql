-- Membership is a typed Case-scoped assignment, not a second permission store.
ALTER TABLE governance_roles ADD COLUMN case_role text
  CHECK (case_role IN ('OWNER', 'EDITOR', 'VIEWER'));
CREATE UNIQUE INDEX governance_roles_workspace_case_role_uq
  ON governance_roles (workspace_id, case_role);
ALTER TABLE governance_role_assignments ADD COLUMN case_membership boolean NOT NULL DEFAULT false;
ALTER TABLE governance_role_assignments ADD CONSTRAINT governance_case_membership_shape
  CHECK (NOT case_membership OR (subject_type = 'USER' AND scope_type = 'CASE'));
CREATE UNIQUE INDEX governance_case_membership_active_uq
  ON governance_role_assignments (workspace_id, scope_resource_id, subject_id)
  WHERE case_membership AND status = 'ACTIVE';
CREATE INDEX governance_case_membership_list_idx
  ON governance_role_assignments (workspace_id, subject_id, scope_resource_id DESC)
  WHERE case_membership AND status = 'ACTIVE';
ALTER TABLE governance_assignment_history ADD COLUMN reason text
  CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000);

-- Migration-only snapshot of legacy Case creators (ADR-001).
-- UUIDv7: 48-bit milliseconds, version 7, random tail retaining RFC variant bits.
CREATE FUNCTION pg_temp.membership_uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0')
    || '7' || substring(replace(gen_random_uuid()::text, '-', '') FROM 14))::uuid
$$;

INSERT INTO governance_roles
  (id, workspace_id, key, name, status, revision, created_at, updated_at, case_role)
SELECT pg_temp.membership_uuid_v7(), c.workspace_id, 'SYSTEM_CASE_OWNER',
  'Case owner', 'ACTIVE', 1, now(), now(), 'OWNER'
FROM cases c GROUP BY c.workspace_id;

INSERT INTO governance_role_permissions (role_id, permission)
SELECT r.id, p.permission FROM governance_roles r
CROSS JOIN (VALUES ('CASE_VIEW'), ('CASE_UPDATE'), ('GOVERNANCE_ROLE_MANAGE'),
  ('INVESTIGATION_VIEW'), ('INVESTIGATION_CREATE'), ('INVESTIGATION_UPDATE')) p(permission)
WHERE r.case_role = 'OWNER';

INSERT INTO governance_role_assignments
  (id, workspace_id, role_id, subject_type, subject_id, scope_type, scope_resource_type,
   scope_resource_id, status, revision, granted_by_subject_type, granted_by_subject_id,
   granted_at, case_membership)
SELECT pg_temp.membership_uuid_v7(), c.workspace_id, r.id, 'USER', c.created_by_user_id,
  'CASE', 'CASE', c.id, 'ACTIVE', 1, 'SERVICE', 'migration:P1-006', now(), true
FROM cases c
JOIN governance_roles r ON r.workspace_id = c.workspace_id AND r.case_role = 'OWNER'
JOIN workspace_members m ON m.workspace_id = c.workspace_id
  AND m.user_id = c.created_by_user_id AND m.status = 'ACTIVE';

INSERT INTO governance_assignment_history
  (id, assignment_id, workspace_id, action, actor_subject_type, actor_subject_id, occurred_at, reason)
SELECT pg_temp.membership_uuid_v7(), id, workspace_id, 'GRANTED', 'SERVICE',
  'migration:P1-006', now(), 'LEGACY_CASE_CREATOR_BOOTSTRAP'
FROM governance_role_assignments WHERE case_membership;
