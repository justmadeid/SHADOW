import { describe, expect, it } from "vitest";

import { RequestContextStore } from "./request-context.store.js";

describe("RequestContextStore", () => {
  it("keeps contexts isolated by async scope", async () => {
    const store = new RequestContextStore();

    const first = store.run(
      {
        requestId: "request-a",
        traceId: "trace-a",
        issuedAt: new Date().toISOString(),
      },
      async () => {
        await Promise.resolve();
        return store.get().requestId;
      },
    );

    const second = store.run(
      {
        requestId: "request-b",
        traceId: "trace-b",
        issuedAt: new Date().toISOString(),
      },
      async () => {
        await Promise.resolve();
        return store.get().requestId;
      },
    );

    await expect(first).resolves.toBe("request-a");
    await expect(second).resolves.toBe("request-b");
  });
});
