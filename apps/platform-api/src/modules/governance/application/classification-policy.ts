import { Inject, Injectable } from "@nestjs/common";
import type { DataClassification, FieldVisibility } from "@intelligence/contracts";
import {
  assertClassification,
  classificationHandling,
} from "../domain/classification.js";
import {
  assertPermission,
  type Permission,
  type PolicyRequest,
} from "../domain/governance.js";
import { PolicyEnforcer } from "./policy-enforcer.js";

type ClassifiedAccess = { access: PolicyRequest; classification: DataClassification };
export type DisplayPolicyRequest = ClassifiedAccess & {
  fieldKind: "IDENTIFIER" | "TEXT";
  /** Trusted server-side policy. Absence never grants a sensitive text view. */
  fullViewPermission?: Permission;
};
export type ExportPolicyRequest = ClassifiedAccess & {
  policy?: { enabled: boolean; sensitivePermission?: Permission; redacted: boolean };
};
export type SourceAccessPolicyRequest = ClassifiedAccess & {
  policy?: {
    enabled: boolean;
    usePermission: Permission;
    restrictedPermission?: Permission;
    rawPersistence: "DISABLED" | "MINIMIZED" | "SOURCE_POLICY";
  };
};

/** Pure authorization planning: does not export data, call sources, or satisfy audit obligations. */
@Injectable()
export class ClassificationPolicy {
  constructor(@Inject(PolicyEnforcer) private readonly policy: PolicyEnforcer) {}

  async display(input: DisplayPolicyRequest) {
    assertClassification(input.classification);
    let visibility: FieldVisibility = "HIDDEN";
    if (await this.baseAllowed(input)) {
      const sensitive =
        input.classification === "SENSITIVE" || input.classification === "RESTRICTED";
      if (input.fieldKind === "IDENTIFIER" && sensitive) {
        if (await this.allows(input.access, "IDENTIFIER_VIEW_RESTRICTED"))
          visibility = "FULL";
        else if (await this.allows(input.access, "IDENTIFIER_USE_RESTRICTED"))
          visibility = "MATCH_ONLY";
        else visibility = "MASKED";
        // A resource-specific field policy may further constrain full disclosure.
        if (
          visibility === "FULL" &&
          input.fullViewPermission &&
          !(await this.allows(input.access, input.fullViewPermission))
        )
          visibility = "MASKED";
      } else if (input.fieldKind === "TEXT" || input.fieldKind === "IDENTIFIER") {
        if (input.fullViewPermission) {
          if (
            (!sensitive || this.hasReason(input.access)) &&
            (await this.allows(input.access, input.fullViewPermission))
          )
            visibility = "FULL";
        } else if (!sensitive) visibility = "FULL";
      }
    }
    return {
      classification: input.classification,
      visibility,
      requiresDurableAudit:
        (input.classification === "SENSITIVE" || input.classification === "RESTRICTED") &&
        (visibility === "FULL" || visibility === "MATCH_ONLY"),
    };
  }

  async export(input: ExportPolicyRequest) {
    const handling = classificationHandling(input.classification);
    const denied = {
      allowed: false as const,
      code: "DENY_EXPORT_POLICY" as const,
      requiresDurableAudit: true as const,
      handling,
    };
    if (!(await this.baseAllowed(input)) || input.policy?.enabled !== true) return denied;
    if (!(await this.allows(input.access, "EVIDENCE_EXPORT"))) return denied;
    if (input.classification === "SENSITIVE" || input.classification === "RESTRICTED") {
      if (
        !input.policy.sensitivePermission ||
        !(await this.allows(input.access, input.policy.sensitivePermission))
      )
        return denied;
    }
    if (input.classification === "RESTRICTED" && input.policy.redacted !== true)
      return denied;
    return {
      allowed: true as const,
      code: "ALLOW_EXPORT_POLICY" as const,
      requiresDurableAudit: true as const,
      redacted: input.policy.redacted,
      handling,
    };
  }

  async sourceAccess(input: SourceAccessPolicyRequest) {
    const handling = classificationHandling(input.classification);
    const denied = {
      allowed: false as const,
      code: "DENY_SOURCE_POLICY" as const,
      requiresDurableAudit: true as const,
      handling,
    };
    if (!(await this.baseAllowed(input)) || input.policy?.enabled !== true) return denied;
    if (!(await this.allows(input.access, input.policy.usePermission))) return denied;
    if (input.classification === "RESTRICTED") {
      if (
        !this.hasReason(input.access) ||
        !input.policy.restrictedPermission ||
        !(await this.allows(input.access, input.policy.restrictedPermission))
      )
        return denied;
    }
    if (!["DISABLED", "MINIMIZED", "SOURCE_POLICY"].includes(input.policy.rawPersistence))
      return denied;
    const rawPersistence =
      input.classification === "RESTRICTED"
        ? input.policy.rawPersistence === "MINIMIZED"
          ? "MINIMIZED"
          : "DISABLED"
        : input.classification === "SENSITIVE" &&
            input.policy.rawPersistence === "SOURCE_POLICY"
          ? "MINIMIZED"
          : input.policy.rawPersistence;
    return {
      allowed: true as const,
      code: "ALLOW_SOURCE_POLICY" as const,
      requiresDurableAudit: true as const,
      rawPersistence,
      handling,
    };
  }

  private baseAllowed(input: ClassifiedAccess): Promise<boolean> {
    assertClassification(input.classification);
    return this.policy.decide(input.access).then((decision) => decision.allowed);
  }

  private async allows(access: PolicyRequest, permission: Permission): Promise<boolean> {
    assertPermission(permission);
    // Base access has already required membership. Additional capabilities may be
    // separate grants, but must retain the same principal/resource/Case context.
    return (
      await this.policy.decide({
        ...access,
        action: permission,
        context: { ...access.context, caseMembershipRequired: false },
      })
    ).allowed;
  }

  private hasReason(access: PolicyRequest): boolean {
    return (
      typeof access.context?.reasonForAccess === "string" &&
      access.context.reasonForAccess.trim().length > 0
    );
  }
}
