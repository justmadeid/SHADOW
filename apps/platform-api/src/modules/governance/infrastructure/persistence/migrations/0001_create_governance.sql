CREATE TABLE governance_roles (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  key text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT governance_roles_workspace_key_uq UNIQUE (workspace_id, key),
  CONSTRAINT governance_roles_key_format CHECK (key ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE TABLE governance_role_permissions (
  role_id uuid NOT NULL REFERENCES governance_roles(id),
  permission text NOT NULL CHECK (permission IN (
    'WORKSPACE_VIEW',
    'WORKSPACE_MANAGE',
    'CASE_CREATE',
    'CASE_VIEW',
    'CASE_UPDATE',
    'INVESTIGATION_CREATE',
    'INVESTIGATION_VIEW',
    'INVESTIGATION_UPDATE',
    'GOVERNANCE_ROLE_VIEW',
    'GOVERNANCE_ROLE_MANAGE',
    'DISCOVER_ENTITY_EXISTENCE',
    'VIEW_CROSS_CASE_CONTEXT',
    'VIEW_CROSS_CASE_EVIDENCE',
    'IDENTIFIER_USE_RESTRICTED',
    'IDENTIFIER_VIEW_RESTRICTED',
    'EVIDENCE_EXPORT'
  )),
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE governance_role_assignments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  role_id uuid NOT NULL REFERENCES governance_roles(id),
  subject_type text NOT NULL CHECK (subject_type IN ('USER', 'SERVICE')),
  subject_id text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('WORKSPACE', 'CASE', 'RESOURCE')),
  scope_resource_type text,
  scope_resource_id uuid,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  granted_by_subject_type text NOT NULL CHECK (granted_by_subject_type IN ('USER', 'SERVICE')),
  granted_by_subject_id text NOT NULL,
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT governance_assignments_scope_shape_valid CHECK (
    (scope_type = 'WORKSPACE' AND scope_resource_type IS NULL AND scope_resource_id IS NULL)
    OR (scope_type = 'CASE' AND scope_resource_type = 'CASE' AND scope_resource_id IS NOT NULL)
    OR (scope_type = 'RESOURCE' AND scope_resource_type IS NOT NULL AND scope_resource_id IS NOT NULL)
  ),
  CONSTRAINT governance_assignments_resource_type_valid CHECK (
    scope_resource_type IS NULL OR scope_resource_type IN (
      'WORKSPACE', 'CASE', 'INVESTIGATION', 'ENTITY', 'EVIDENCE',
      'IDENTIFIER', 'EXPORT', 'GOVERNANCE'
    )
  )
);

CREATE INDEX governance_assignments_subject_idx
  ON governance_role_assignments (workspace_id, subject_type, subject_id, status);

CREATE INDEX governance_assignments_role_idx
  ON governance_role_assignments (role_id, status);

CREATE TABLE governance_assignment_history (
  id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES governance_role_assignments(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  action text NOT NULL CHECK (action IN ('GRANTED', 'REVOKED')),
  actor_subject_type text NOT NULL CHECK (actor_subject_type IN ('USER', 'SERVICE')),
  actor_subject_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX governance_assignment_history_workspace_idx
  ON governance_assignment_history (workspace_id, occurred_at);
