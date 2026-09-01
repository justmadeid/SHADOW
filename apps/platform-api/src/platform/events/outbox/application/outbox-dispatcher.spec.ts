import { describe, expect, it, vi } from "vitest";
import pino from "pino";

import type { OutboxEventRecord } from "../domain/outbox-event.js";
import type { OutboxPublisher } from "../domain/outbox-publisher.js";
import type { OutboxStore } from "../domain/outbox-store.js";
import { OutboxDispatcher } from "./outbox-dispatcher.js";

function event(): OutboxEventRecord {
  const now = new Date();

  return {
    id: "0198-test",
    type: "RUN_REQUESTED",
    version: 1,
    aggregateType: "RUN",
    aggregateId: "0198-run",
    payload: {
      runId: "0198-run",
    },
    requestId: "request-1",
    traceParent: null,
    occurredAt: now,
    availableAt: now,
    attemptCount: 1,
    leaseOwner: "dispatcher-a",
    leasedUntil: new Date(now.getTime() + 30_000),
    publishedAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
  };
}

describe("OutboxDispatcher", () => {
  it("marks a successfully published event", async () => {
    const item = event();

    const store: OutboxStore = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue([item]),
      markPublished: vi.fn().mockResolvedValue(true),
      markFailed: vi.fn(),
    };

    const publisher: OutboxPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const dispatcher = new OutboxDispatcher(store, publisher, pino({ enabled: false }));

    await expect(
      dispatcher.dispatchOnce({
        leaseOwner: "dispatcher-a",
      }),
    ).resolves.toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
    });

    expect(store.markPublished).toHaveBeenCalledWith({
      id: item.id,
      leaseOwner: "dispatcher-a",
    });
  });

  it("reschedules publisher failure without storing raw error text", async () => {
    const item = event();

    const store: OutboxStore = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue([item]),
      markPublished: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(true),
    };

    const publisher: OutboxPublisher = {
      publish: vi.fn().mockRejectedValue(
        Object.assign(new Error("raw provider secret should not persist"), {
          code: "BROKER_UNAVAILABLE",
        }),
      ),
    };

    const dispatcher = new OutboxDispatcher(store, publisher, pino({ enabled: false }));

    const result = await dispatcher.dispatchOnce({
      leaseOwner: "dispatcher-a",
    });

    expect(result).toMatchObject({
      claimed: 1,
      published: 0,
      failed: 1,
    });

    expect(store.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: item.id,
        leaseOwner: "dispatcher-a",
        errorCode: "BROKER_UNAVAILABLE",
      }),
    );
  });
});
