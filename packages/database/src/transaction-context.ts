import { AsyncLocalStorage } from "node:async_hooks";

import type { DatabaseTransaction } from "./types.js";

const storage = new AsyncLocalStorage<DatabaseTransaction>();

export function currentTransaction(): DatabaseTransaction | undefined {
  return storage.getStore();
}

export async function runWithTransactionContext<T>(
  transaction: DatabaseTransaction,
  callback: () => Promise<T>,
): Promise<T> {
  return storage.run(transaction, callback);
}
