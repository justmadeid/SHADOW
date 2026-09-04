export { GovernanceModule } from "./governance.module.js";
export {
  ClassificationPolicy,
  type DisplayPolicyRequest,
  type ExportPolicyRequest,
  type SourceAccessPolicyRequest,
} from "./application/classification-policy.js";
export {
  classificationHandling,
  deriveClassification,
  presentClassifiedField,
} from "./domain/classification.js";
export { CaseMembershipFacade } from "./application/case-membership.facade.js";
export type { CaseMembership, CaseRole } from "./domain/case-membership.js";
export { PolicyEnforcer, type EnforceOptions } from "./application/policy-enforcer.js";
export { PERMISSIONS } from "./domain/governance.js";
export type {
  GovernanceResourceType,
  GovernanceAction,
  GovernanceScope,
  Permission,
  PolicyContext,
  PolicyDecision,
  PolicyRequest,
  PolicyResource,
} from "./domain/governance.js";
