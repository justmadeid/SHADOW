import type { Logger } from "pino";

import type { OutboxPublisher } from "../domain/outbox-publisher.js";
import type { OutboxStore } from "../domain/outbox-store.js";
import { computeRetryDelayMs } from "../domain/retry-policy.js";

export type OutboxDispatcherOptions = {
  leaseOwner: string;
  batchSize?: number;
  leaseDurationMs?: number;
};

export type DispatchCycleResult = {
  claimed: number;
  published: number;
  failed: number;
};

export class OutboxDispatcher {
  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: OutboxPublisher,
    private readonly logger: Logger,
  ) {}

  async dispatchOnce(options: OutboxDispatcherOptions): Promise<DispatchCycleResult> {
    const events = await this.store.claim({
      leaseOwner: options.leaseOwner,
      batchSize: options.batchSize ?? 100,
      leaseDurationMs: options.leaseDurationMs ?? 30_000,
    });

    let published = 0;
    let failed = 0;

    for (const event of events) {
      try {
        await this.publisher.publish(event);

        const marked = await this.store.markPublished({
          id: event.id,
          leaseOwner: options.leaseOwner,
        });

        if (!marked) {
          this.logger.warn(
            {
              event: "outbox.publish.lease_lost",
              outboxEventId: event.id,
              eventType: event.type,
            },
            "Outbox event was published but lease ownership was no longer valid",
          );
        }

        published += 1;
      } catch (error) {
        failed += 1;

        const delayMs = computeRetryDelayMs(event.attemptCount);
        const nextAvailableAt = new Date(Date.now() + delayMs);
        const errorCode = errorCodeFrom(error);

        await this.store.markFailed({
          id: event.id,
          leaseOwner: options.leaseOwner,
          errorCode,
          nextAvailableAt,
        });

        this.logger.warn(
          {
            event: "outbox.publish.failed",
            outboxEventId: event.id,
            eventType: event.type,
            attemptCount: event.attemptCount,
            errorCode,
            retryDelayMs: delayMs,
          },
          "Outbox publish failed and was rescheduled",
        );
      }
    }

    return {
      claimed: events.length,
      published,
      failed,
    };
  }
}

function errorCodeFrom(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return "OUTBOX_PUBLISH_FAILED";
}
