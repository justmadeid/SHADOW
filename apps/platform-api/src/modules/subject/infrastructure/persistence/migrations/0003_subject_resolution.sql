-- migration-safety: allow-destructive ADR-013
ALTER TABLE investigation_subjects
  DROP CONSTRAINT investigation_subjects_status_check,
  ADD COLUMN entity_id uuid,
  ADD CONSTRAINT investigation_subjects_status_check
    CHECK (status IN ('UNRESOLVED', 'RESOLVING', 'RESOLVED', 'RESOLUTION_FAILED', 'ARCHIVED')),
  ADD CONSTRAINT investigation_subjects_resolution_shape CHECK (
    (status = 'RESOLVED' AND entity_id IS NOT NULL)
    OR (status IN ('UNRESOLVED', 'RESOLVING', 'RESOLUTION_FAILED') AND entity_id IS NULL)
    OR status = 'ARCHIVED'
  ),
  ADD CONSTRAINT investigation_subjects_entity_scope_fk
    FOREIGN KEY (entity_id, workspace_id) REFERENCES entities(id, workspace_id);

ALTER TABLE subject_revisions
  DROP CONSTRAINT subject_revisions_status_check,
  ADD COLUMN entity_id uuid,
  ADD CONSTRAINT subject_revisions_status_check
    CHECK (status IN ('UNRESOLVED', 'RESOLVING', 'RESOLVED', 'RESOLUTION_FAILED', 'ARCHIVED')),
  ADD CONSTRAINT subject_revisions_resolution_shape CHECK (
    (status = 'RESOLVED' AND entity_id IS NOT NULL)
    OR (status IN ('UNRESOLVED', 'RESOLVING', 'RESOLUTION_FAILED') AND entity_id IS NULL)
    OR status = 'ARCHIVED'
  );
