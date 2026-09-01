import type { JsonObject, OutboxEventInput, OutboxEventRecord } from "./outbox-event.js";

export interface OutboxStore {
  enqueue<TPayload extends JsonObject>(
    event: OutboxEventInput<TPayload>,
  ): Promise<string>;

  claim(options: {
    leaseOwner: string;
    batchSize: number;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<OutboxEventRecord[]>;

  markPublished(options: {
    id: string;
    leaseOwner: string;
    publishedAt?: Date;
  }): Promise<boolean>;

  markFailed(options: {
    id: string;
    leaseOwner: string;
    errorCode: string;
    nextAvailableAt: Date;
    failedAt?: Date;
  }): Promise<boolean>;
}
