import type { PlatformDatabase } from "./types.js";
import { currentTransaction } from "./transaction-context.js";

export class DatabaseContext {
  constructor(private readonly db: PlatformDatabase) {}

  /**
   * Repositories call this accessor. If the application layer opened a
   * transaction, repositories automatically share that transaction.
   */
  connection(): PlatformDatabase {
    return (currentTransaction() ?? this.db) as PlatformDatabase;
  }
}
