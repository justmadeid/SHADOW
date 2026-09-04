import { Inject, Injectable } from "@nestjs/common";
import { currentTransaction, DrizzleTransactionManager } from "@intelligence/database";
import type { FieldVisibility, MatchStatus } from "@intelligence/contracts";
import { AuditFacade, type AuditInput } from "../../audit/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { CaseMembershipFacade } from "./case-membership.facade.js";
import { presentClassifiedField } from "../domain/classification.js";
import {
  ClassificationPolicy,
  type DisplayPolicyRequest,
  type ExportPolicyRequest,
  type SourceAccessPolicyRequest,
} from "./classification-policy.js";

export type AuditOperation = { operationId: string; resourceRevision?: number };

/** Release boundary: returns only after its audit transaction has committed. */
@Injectable()
export class AuditedDataAccess {
  constructor(
    @Inject(ClassificationPolicy) private readonly policy: ClassificationPolicy,
    @Inject(AuditFacade) private readonly audit: AuditFacade,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(CaseMembershipFacade) private readonly memberships: CaseMembershipFacade,
  ) {}

  async display(
    input: DisplayPolicyRequest,
    operation: AuditOperation,
    load: (
      visibility: Extract<FieldVisibility, "FULL" | "MATCH_ONLY">,
    ) => Promise<{ value?: string; matchStatus?: MatchStatus }>,
  ) {
    this.requireReleaseBoundary();
    return this.transactions.run(async () => {
      await this.lockCase(input);
      const decision = await this.policy.display(input);
      if (
        decision.requiresDurableAudit ||
        (decision.visibility === "HIDDEN" &&
          (input.classification === "SENSITIVE" || input.classification === "RESTRICTED"))
      ) {
        await this.audit.record(
          this.event(
            input,
            operation,
            decision.visibility === "MATCH_ONLY"
              ? "SENSITIVE_FIELD_MATCH"
              : "SENSITIVE_FIELD_VIEW",
            decision.visibility === "HIDDEN" ? "DENIED" : "AUTHORIZED",
          ),
        );
      }
      let field: { value?: string; matchStatus?: MatchStatus } = {};
      if (decision.visibility === "FULL" || decision.visibility === "MATCH_ONLY") {
        try {
          field = await load(decision.visibility);
          return presentClassifiedField(decision, field);
        } catch {
          throw new AppError({
            code: "AUDIT_DISCLOSURE_LOAD_FAILED",
            message: "Protected data could not be loaded.",
            statusCode: 503,
          });
        }
      }
      return presentClassifiedField(decision, field);
    });
  }

  async authorizeExport(input: ExportPolicyRequest, operation: AuditOperation) {
    this.requireReleaseBoundary();
    return this.transactions.run(async () => {
      await this.lockCase(input);
      const decision = await this.policy.export(input);
      const auditEventId = await this.audit.record(
        this.event(
          input,
          operation,
          "EVIDENCE_EXPORT_AUTHORIZATION",
          decision.allowed ? "AUTHORIZED" : "DENIED",
        ),
      );
      return { ...decision, auditEventId };
    });
  }

  async authorizeSource(input: SourceAccessPolicyRequest, operation: AuditOperation) {
    this.requireReleaseBoundary();
    return this.transactions.run(async () => {
      await this.lockCase(input);
      const decision = await this.policy.sourceAccess(input);
      const auditEventId = await this.audit.record(
        this.event(
          input,
          operation,
          "SOURCE_ACCESS_AUTHORIZATION",
          decision.allowed ? "AUTHORIZED" : "DENIED",
        ),
      );
      return { ...decision, auditEventId };
    });
  }

  private event(
    input: DisplayPolicyRequest | ExportPolicyRequest | SourceAccessPolicyRequest,
    operation: AuditOperation,
    action: AuditInput["action"],
    outcome: "AUTHORIZED" | "DENIED",
  ): AuditInput {
    const resource = input.access.resource;
    const caseId = resource.type === "CASE" ? resource.id : input.access.context?.caseId;
    const reason = input.access.context?.reasonForAccess?.trim();
    return {
      operationId: operation.operationId,
      action,
      outcome,
      classification: input.classification,
      resource: { ...resource, ...(caseId ? { caseId } : {}) },
      ...(operation.resourceRevision === undefined
        ? {}
        : { resourceRevision: operation.resourceRevision }),
      ...(reason ? { reason } : {}),
    };
  }

  private async lockCase(
    input: DisplayPolicyRequest | ExportPolicyRequest | SourceAccessPolicyRequest,
  ): Promise<void> {
    const resource = input.access.resource;
    const caseId = resource.type === "CASE" ? resource.id : input.access.context?.caseId;
    if (caseId) await this.memberships.lockCase(resource.workspaceId, caseId);
  }

  private requireReleaseBoundary(): void {
    if (currentTransaction())
      throw new AppError({
        code: "AUDIT_RELEASE_BOUNDARY_REQUIRED",
        message: "Audited disclosure must own its commit boundary.",
        statusCode: 500,
      });
  }
}
