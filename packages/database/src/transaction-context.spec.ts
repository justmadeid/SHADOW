import { describe, expect, it } from "vitest";

import { currentTransaction, runWithTransactionContext } from "./transaction-context.js";
import type { DatabaseTransaction } from "./types.js";

describe("transaction context", () => {
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
