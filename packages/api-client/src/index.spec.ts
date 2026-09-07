import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./index.js";
describe("shell API client", () => {
  it("uses no-store and cancellation, returning only validated presentation fields", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        items: [
          {
            id: "01900000-0000-7000-8000-000000000001",
            name: "Synthetic",
            secretExtra: "private",
          },
        ],
      }),
    );
    const signal = new AbortController().signal;
    const result = await createApiClient({ baseUrl: "/api/platform/", fetch }).workspaces(
      signal,
    );
    expect(result.items[0]).not.toHaveProperty("secretExtra");
    expect(fetch).toHaveBeenCalledWith(
      "/api/platform/workspaces",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin", signal }),
    );
  });
  it.each([401, 403, 404, 503])(
    "does not expose upstream error content for %i",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("synthetic-private-error", { status }));
      await expect(
        createApiClient({ baseUrl: "/api/platform", fetch }).workspaces(),
      ).rejects.toMatchObject({ status });
      await expect(
        createApiClient({ baseUrl: "/api/platform", fetch }).workspaces(),
      ).rejects.not.toThrow("private");
    },
  );
  it("rejects malformed response data instead of treating it as trusted permissions", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ permissions: { update: "true" } }));
    await expect(
      createApiClient({ baseUrl: "/api/platform", fetch }).caseAccess("id"),
    ).rejects.toMatchObject({ status: 502 });
  });
  it("sends explicit idempotency and optimistic-concurrency mutation headers", async () => {
    const detail = {
      id: "01900000-0000-7000-8000-000000000001",
      workspaceId: "01900000-0000-7000-8000-000000000002",
      code: "CASE-SYNTHETIC",
      title: "Synthetic Case",
      description: null,
      classification: "INTERNAL",
      status: "DRAFT",
      revision: 2,
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
      closedAt: null,
      archivedAt: null,
    };
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(detail, { status: 201 })));
    const client = createApiClient({ baseUrl: "/api/platform", fetch });
    await client.createCase(
      {
        workspaceId: detail.workspaceId,
        title: detail.title,
        description: null,
        classification: "INTERNAL",
      },
      "synthetic-key-1",
    );
    await client.updateCase(
      detail.id,
      {
        title: detail.title,
        description: null,
        classification: "INTERNAL",
      },
      2,
    );
    expect(fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "idempotency-key": "synthetic-key-1" }),
      }),
    );
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "if-match": '"2"' }),
      }),
    );
  });
});
