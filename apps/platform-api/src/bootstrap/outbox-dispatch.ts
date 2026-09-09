import type { Logger } from "pino";
import { DatabaseContext } from "@intelligence/database";
import { OutboxDispatcher } from "../platform/events/outbox/application/outbox-dispatcher.js";
import { createConnectorGeneralQueue } from "../platform/events/outbox/infrastructure/queue/connector-general-queue.js";
import { BullMqOutboxPublisher } from "../platform/events/outbox/infrastructure/queue/bullmq-outbox-publisher.js";
import { PostgresOutboxStore } from "../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import { RequestContextStore } from "../platform/request-context/index.js";
import { newUuid } from "../platform/ids/uuid.js";

// 5s: frequent enough that a Run's worker sees its job promptly, coarse
// enough that a busy dispatch table is not hammered by every platform-api
// replica at once. Running this loop in multiple replicas is already safe:
// OutboxStore.claim() leases rows with SELECT ... FOR UPDATE SKIP LOCKED
// keyed by a per-process leaseOwner, the same mechanism that already made
// multi-instance dispatch safe before this task ever ran a consumer.
const DISPATCH_INTERVAL_MS = 5_000;
const BATCH_SIZE = 50;
const LEASE_DURATION_MS = 30_000;

export type OutboxDispatchHandle = {
  stop: () => Promise<void>;
};

/**
 * Starts the platform-api-internal Outbox -> BullMQ dispatch loop. This is
 * not a separate deployable: the connector-worker that *consumes*
 * `connector.general` is P3-007, out of scope here. This loop only produces
 * jobs, driven by the same DatabaseContext/logger the rest of the app uses.
 *
 * Always dispatches with `eventTypes: ["RUN_CREATED"]`. The Outbox table
 * (`platform_outbox_events`) is shared by every module in this codebase;
 * dispatching unfiltered against a publisher that only understands
 * RUN_CREATED would silently mark every other module's historical events as
 * "published" without ever delivering them.
 */
export function startOutboxDispatchLoop(
  database: DatabaseContext,
  redisUrl: string,
  logger: Logger,
): OutboxDispatchHandle {
  const store = new PostgresOutboxStore(database, new RequestContextStore());
  const { queue, close } = createConnectorGeneralQueue(redisUrl);
  const publisher = new BullMqOutboxPublisher(queue);
  const dispatcher = new OutboxDispatcher(store, publisher, logger);

  const leaseOwner = `platform-api:${process.pid}:${newUuid()}`;
  let inFlight = false;

  const timer = setInterval(() => {
    if (inFlight) return; // skip this tick rather than overlap with the previous one
    inFlight = true;
    dispatcher
      .dispatchOnce({
        leaseOwner,
        eventTypes: ["RUN_CREATED"],
        batchSize: BATCH_SIZE,
        leaseDurationMs: LEASE_DURATION_MS,
      })
      .catch((error: unknown) => {
        logger.warn(
          { event: "outbox.dispatch_loop.tick_failed", error },
          "Outbox dispatch tick failed; will retry on the next interval",
        );
      })
      .finally(() => {
        inFlight = false;
      });
  }, DISPATCH_INTERVAL_MS);
  timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      await close();
    },
  };
}
