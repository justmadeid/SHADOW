import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { CONNECTOR_GENERAL_QUEUE } from "./bullmq-outbox-publisher.js";

export type ConnectorGeneralQueueHandle = {
  connection: Redis;
  queue: Queue;
  close: () => Promise<void>;
};

/**
 * Creates the Redis connection and BullMQ Queue used to dispatch the
 * `connector.general` coarse pool. `enableOfflineQueue: false` and a short
 * `connectTimeout` are deliberate: a broker outage must fail a dispatch
 * attempt promptly (so the existing OutboxDispatcher retry/backoff path
 * handles it) rather than buffering commands indefinitely against an
 * unreachable Redis.
 */
export function createConnectorGeneralQueue(
  redisUrl: string,
): ConnectorGeneralQueueHandle {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    retryStrategy: () => null,
    lazyConnect: false,
  });
  // ioredis throws if an 'error' listener is never attached; the dispatch
  // loop's own try/catch around dispatchOnce() is what actually surfaces a
  // broker-outage failure to the caller/logs.
  connection.on("error", () => {
    /* handled by the dispatch loop's own error path */
  });

  const queue = new Queue(CONNECTOR_GENERAL_QUEUE, { connection });

  return {
    connection,
    queue,
    close: async () => {
      // Best-effort: against an unreachable broker, queue.close()'s graceful
      // shutdown can itself fail to communicate with Redis. Callers (e.g. a
      // broker-outage test's cleanup) must never have their own assertions
      // masked by a throw here.
      try {
        await queue.close();
      } catch {
        // ignore
      }
      connection.disconnect();
    },
  };
}
