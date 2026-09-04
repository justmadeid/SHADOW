import { describe, expect, it } from "vitest";

import {
  currentTransaction,
  runWithTransactionContext,
  markTransactionRollbackOnly,
} from "./transaction-context.js";
import type { DatabaseTransaction } from "./types.js";

describe("transaction context", () => {
  it("rejects a rollback-only transaction even if the application swallowed the failure", async () => {
    await expect(
      runWithTransactionContext({} as DatabaseTransaction, async () => {
        markTransactionRollbackOnly();
        return "would otherwise commit";
      }),
    ).rejects.toThrow("Transaction marked rollback-only.");
    expect(currentTransaction()).toBeUndefined();
    await expect(
      runWithTransactionContext({} as DatabaseTransaction, async () => "unrelated"),
    ).resolves.toBe("unrelated");
  });
  it("is scoped to the async execution flow", async () => {
    const fakeTransaction = {} as DatabaseTransaction;

    expect(currentTransaction()).toBeUndefined();

    await runWithTransactionContext(fakeTransaction, async () => {
      expect(currentTransaction()).toBe(fakeTransaction);
      await Promise.resolve();
      expect(currentTransaction()).toBe(fakeTransaction);
    });

    expect(currentTransaction()).toBeUndefined();
  });
});
