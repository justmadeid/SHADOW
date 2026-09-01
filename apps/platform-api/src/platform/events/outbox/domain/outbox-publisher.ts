import type { OutboxEventRecord } from "./outbox-event.js";

export interface OutboxPublisher {
  publish(event: OutboxEventRecord): Promise<void>;
}
