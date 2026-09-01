import type { PlatformDatabase } from "./types.js";
import { currentTransaction, runWithTransactionContext } from "./transaction-context.js";

export interface TransactionManager {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export class DrizzleTransactionManager implements TransactionManager {
  constructor(private readonly db: PlatformDatabase) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    // Nested application use cases reuse the existing transaction context
    // rather than silently opening an independent transaction.
    if (currentTransaction()) {
      return work();
    }

    return this.db.transaction(async (tx) => runWithTransactionContext(tx, work));
  }
}
