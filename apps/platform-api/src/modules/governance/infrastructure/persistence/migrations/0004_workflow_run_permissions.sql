-- migration-safety: allow-destructive ADR-017
-- Only replace the permission CHECK with a strict superset; no rows are deleted.
ALTER TABLE governance_role_permissions DROP CONSTRAINT governance_role_permissions_permission_check;
ALTER TABLE governance_role_permissions ADD CONSTRAINT governance_role_permissions_permission_check CHECK (permission IN (
  'WORKSPACE_VIEW', 'WORKSPACE_MANAGE', 'CASE_CREATE', 'CASE_VIEW', 'CASE_UPDATE',
  'INVESTIGATION_CREATE', 'INVESTIGATION_VIEW', 'INVESTIGATION_UPDATE',
  'SUBJECT_CREATE', 'SUBJECT_VIEW', 'SUBJECT_UPDATE',
  'GOVERNANCE_ROLE_VIEW', 'GOVERNANCE_ROLE_MANAGE', 'DISCOVER_ENTITY_EXISTENCE',
  'VIEW_CROSS_CASE_CONTEXT', 'VIEW_CROSS_CASE_EVIDENCE', 'IDENTIFIER_USE_RESTRICTED',
  'IDENTIFIER_VIEW_RESTRICTED', 'EVIDENCE_EXPORT',
  'WORKFLOW_VIEW', 'WORKFLOW_CREATE', 'WORKFLOW_UPDATE',
  'RUN_CREATE', 'RUN_VIEW', 'RUN_CANCEL'
));

-- Extend only typed system Case roles, never arbitrary custom roles/assignments.
-- OWNER/EDITOR receive the full Workflow/Run permission set; VIEWER receives read-only.
INSERT INTO governance_role_permissions (role_id, permission)
SELECT r.id, p.permission FROM governance_roles r
CROSS JOIN (VALUES
  ('WORKFLOW_VIEW'), ('WORKFLOW_CREATE'), ('WORKFLOW_UPDATE'),
  ('RUN_CREATE'), ('RUN_VIEW'), ('RUN_CANCEL')
) p(permission)
WHERE r.case_role IN ('OWNER', 'EDITOR', 'VIEWER')
  AND (
    p.permission IN ('WORKFLOW_VIEW', 'RUN_VIEW')
    OR r.case_role IN ('OWNER', 'EDITOR')
  )
ON CONFLICT DO NOTHING;
