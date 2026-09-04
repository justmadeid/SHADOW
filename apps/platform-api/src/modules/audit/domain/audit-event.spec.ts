import { describe, expect, it } from "vitest";
import { newUuid } from "../../../platform/ids/uuid.js";
import { validateAuditInput, type AuditInput } from "./audit-event.js";

const caseId = newUuid();
const input: AuditInput = {
  operationId: newUuid(),
  action: "CASE_MEMBERSHIP_GRANTED",
  outcome: "SUCCEEDED",
  resource: { type: "CASE", id: caseId, workspaceId: newUuid(), caseId },
  membershipId: newUuid(),
  resourceRevision: 1,
  reason: "Synthetic review",
};
describe("Audit event input", () => {
  it("accepts reference-only membership events", () => {
    expect(() => validateAuditInput(input)).not.toThrow();
  });
  it.each([
    { actorId: "spoof" },
    { rawValue: "synthetic-private" },
    { metadata: { phone: "synthetic" } },
    { reason: " " },
    { reason: "x".repeat(1001) },
    { operationId: "invalid" },
    { action: "FAKE" },
    { outcome: "AUTHORIZED" },
    { membershipId: undefined },
    { resourceRevision: 0 },
    { resource: { ...input.resource, caseId: newUuid() } },
    { resource: { ...input.resource, raw: "payload" } },
  ])("rejects invalid or unbounded audit data %# without reflecting it", (change) => {
    expect(() => validateAuditInput({ ...input, ...change } as AuditInput)).toThrow(
      expect.objectContaining({ code: "AUDIT_INPUT_INVALID", details: undefined }),
    );
  });
  it("requires classification and reason for authorized sensitive operations, but permits missing reason on denial", () => {
    const sensitive: AuditInput = {
      operationId: newUuid(),
      action: "SENSITIVE_FIELD_VIEW",
      outcome: "AUTHORIZED",
      resource: input.resource,
      classification: "RESTRICTED",
      reason: "Review",
    };
    expect(() => validateAuditInput(sensitive)).not.toThrow();
    const withoutReason = { ...sensitive };
    delete withoutReason.reason;
    expect(() => validateAuditInput(withoutReason)).toThrow();
    expect(() =>
      validateAuditInput({ ...withoutReason, outcome: "DENIED" }),
    ).not.toThrow();
    expect(() => validateAuditInput({ ...sensitive, outcome: "SUCCEEDED" })).toThrow();
  });
});
