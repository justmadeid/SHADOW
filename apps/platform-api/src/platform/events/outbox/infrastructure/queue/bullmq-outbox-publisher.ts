import type { Queue } from "bullmq";
import type { OutboxEventRecord } from "../../domain/outbox-event.js";
import type { OutboxPublisher } from "../../domain/outbox-publisher.js";

/**
 * Coarse general worker pool queue name
 * (docs/knowledge/07_WORKFLOW_EXECUTION_CONNECTORS.md §21). Only the general
 * pool exists in this slice — there is no restricted pool yet, since Source
 * Registry/connector resolution (P4-001+) does not exist to determine which
 * Runs would even need one.
 */
export const CONNECTOR_GENERAL_QUEUE = "connector.general";

/**
 * Routes exactly one Outbox event type — RUN_CREATED — onto the coarse
 * `connector.general` BullMQ queue. The `OutboxDispatcher` that owns this
 * publisher must always be called with `eventTypes: ["RUN_CREATED"]` (see
 * outbox-dispatcher.ts); this class defensively refuses (throws, which the
 * dispatcher treats as a publish failure to retry/log, never a silent
 * publish) any other event type reaching it, rather than silently dropping
 * or mis-routing it.
 *
 * Job data is deliberately minimal — `{ runId, outboxEventId }` only, never
 * the Outbox payload, never any config/binding/credential value ("dispatch
 * minimal run reference"; secrets never reach the job payload because
 * `assertSafeOutboxPayload` already ran at enqueue() time, and this
 * publisher does not even forward that payload). The BullMQ job id is the
 * Outbox event's own id, so a duplicate dispatch of the same event (e.g. a
 * lease-loss race re-claiming the same row) is naturally deduplicated by
 * BullMQ itself — this is what makes replay idempotent.
 */
export class BullMqOutboxPublisher implements OutboxPublisher {
  constructor(private readonly queue: Queue) {}

  async publish(event: OutboxEventRecord): Promise<void> {
    if (event.type !== "RUN_CREATED")
      throw new Error(
        `BullMqOutboxPublisher received an unexpected event type: ${event.type}. ` +
          'The OutboxDispatcher driving this publisher must filter to eventTypes: ["RUN_CREATED"].',
      );

    const runId = event.aggregateId;
    if (!runId)
      throw new Error("RUN_CREATED outbox event is missing an aggregateId to dispatch.");

    await this.queue.add(
      event.type,
      { runId, outboxEventId: event.id },
      { jobId: event.id },
    );
  }
}
