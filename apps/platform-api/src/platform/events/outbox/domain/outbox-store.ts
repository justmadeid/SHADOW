import type { JsonObject, OutboxEventInput, OutboxEventRecord } from "./outbox-event.js";

export interface OutboxStore {
  enqueue<TPayload extends JsonObject>(
    event: OutboxEventInput<TPayload>,
  ): Promise<string>;

  /**
   * `eventTypes`, when provided, restricts the claim to those event types
   * only (`WHERE event_type = ANY(...)`). Omitting it preserves the exact
   * unfiltered behavior every existing caller already relies on — this is a
   * purely additive, backward-compatible parameter. `platform_outbox_events`
   * is one physical table shared by every module (Case, Subject, Entity,
   * Investigation, Governance, Workflow, Execution); an unfiltered claim from
   * a dispatcher wired to a publisher that only understands one event type
   * would silently mark unrelated historical events as "published" when they
   * were never actually delivered anywhere. Callers dispatching to a
   * type-specific publisher (e.g. the BullMQ RUN_CREATED dispatcher) must
   * always pass `eventTypes`.
   */
  claim(options: {
    leaseOwner: string;
    batchSize: number;
    leaseDurationMs: number;
    eventTypes?: readonly string[];
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
