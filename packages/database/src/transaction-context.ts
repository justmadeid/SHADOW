import { AsyncLocalStorage } from "node:async_hooks";

import type { DatabaseTransaction } from "./types.js";

const storage = new AsyncLocalStorage<{
  transaction: DatabaseTransaction;
  rollbackOnly: boolean;
}>();

export function currentTransaction(): DatabaseTransaction | undefined {
  return storage.getStore()?.transaction;
}

/** Critical invariant failures cannot be swallowed to commit the outer transaction. */
export function markTransactionRollbackOnly(): void {
  const state = storage.getStore();
  if (!state) throw new Error("A transaction is required.");
  state.rollbackOnly = true;
}

export async function runWithTransactionContext<T>(
  transaction: DatabaseTransaction,
  callback: () => Promise<T>,
): Promise<T> {
  const state = { transaction, rollbackOnly: false };
  return storage.run(state, async () => {
    const result = await callback();
    if (state.rollbackOnly) throw new Error("Transaction marked rollback-only.");
    return result;
  });
}
