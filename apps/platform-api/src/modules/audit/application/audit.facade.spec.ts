import { describe, expect, it, vi } from "vitest";
import {
  runWithTransactionContext,
  type DatabaseTransaction,
} from "@intelligence/database";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { newUuid } from "../../../platform/ids/uuid.js";
import { AuditFacade } from "./audit.facade.js";
import type { AuditInput } from "../domain/audit-event.js";

describe("Critical audit recording", () => {
  const id = newUuid();
  const input: AuditInput = {
    operationId: newUuid(),
    action: "EVIDENCE_EXPORT_AUTHORIZATION",
    outcome: "DENIED",
    classification: "RESTRICTED",
    resource: { type: "CASE", id, caseId: id, workspaceId: newUuid() },
  };
  it("refuses recording outside the business transaction", async () => {
    const append = vi.fn();
    await expect(
      new AuditFacade({ append }, new RequestContextStore()).record(input),
    ).rejects.toMatchObject({ code: "AUDIT_TRANSACTION_REQUIRED" });
    expect(append).not.toHaveBeenCalled();
  });
  it("requires a verified actor, not legacy userId context", async () => {
    const context = new RequestContextStore();
    const append = vi.fn();
    const audit = new AuditFacade({ append }, context);
    await expect(
      context.run(
        {
          requestId: "request",
          traceId: "trace",
          issuedAt: new Date().toISOString(),
          userId: "unverified",
        },
        () =>
          runWithTransactionContext({} as DatabaseTransaction, () => audit.record(input)),
      ),
    ).rejects.toMatchObject({ code: "AUDIT_ACTOR_REQUIRED" });
    expect(append).not.toHaveBeenCalled();
  });
  it("sanitizes persistence errors and poisons the transaction when callers catch them", async () => {
    const context = new RequestContextStore();
    const audit = new AuditFacade(
      {
        append: vi.fn().mockRejectedValue(new Error("SQL with synthetic-private-reason")),
      },
      context,
    );
    await expect(
      context.run(
        {
          requestId: "request",
          traceId: "trace",
          issuedAt: new Date().toISOString(),
          principal: {
            kind: "SERVICE",
            subject: "worker",
            serviceId: "worker",
            clientId: "worker",
            issuer: "https://example.test",
          },
        },
        () =>
          runWithTransactionContext({} as DatabaseTransaction, async () => {
            await expect(audit.record(input)).rejects.toMatchObject({
              code: "AUDIT_DURABILITY_FAILED",
              cause: undefined,
              message: "Required audit could not be persisted.",
            });
          }),
      ),
    ).rejects.toThrow("Transaction marked rollback-only.");
  });
  it("takes service identity and correlation from trusted context rather than audit input", async () => {
    const context = new RequestContextStore();
    const append = vi.fn().mockResolvedValue(id);
    const audit = new AuditFacade({ append }, context);
    await context.run(
      {
        requestId: "request",
        traceId: "trace",
        issuedAt: new Date().toISOString(),
        principal: {
          kind: "SERVICE",
          subject: "subject",
          serviceId: "verified-worker",
          clientId: "client",
          issuer: "https://example.test",
        },
      },
      () =>
        runWithTransactionContext({} as DatabaseTransaction, () => audit.record(input)),
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "SERVICE",
        actorId: "verified-worker",
        requestId: "request",
        traceId: "trace",
        version: 1,
      }),
    );
  });
});
