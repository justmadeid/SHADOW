import { describe, expect, it } from "vitest";
import { parseMutationInput, readMutationBody } from "./mutation-input";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const headers = (values: Record<string, string>) => new Headers(values);

describe("shell mutation input boundary", () => {
  it("bounds streamed bytes without trusting Content-Length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a".repeat(8000)));
        controller.enqueue(new TextEncoder().encode("é".repeat(100)));
        controller.close();
      },
    });
    expect(await readMutationBody(body)).toBeNull();
  });
  it("decodes split UTF-8 chunks within the byte limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xc3]));
        controller.enqueue(new Uint8Array([0xa9]));
        controller.close();
      },
    });
    expect(await readMutationBody(body)).toBe("é");
  });
  it("accepts the exact create Case contract", () => {
    const result = parseMutationInput(
      "CREATE_CASE",
      JSON.stringify({
        workspaceId,
        title: "Synthetic Case",
        description: null,
        classification: "INTERNAL",
      }),
      headers({
        "content-type": "application/json",
        "idempotency-key": "synthetic-key-1",
      }),
    );
    expect(result).toMatchObject({ idempotencyKey: "synthetic-key-1" });
  });

  it.each([
    { title: "Synthetic", description: null, classification: "INTERNAL", admin: true },
    { title: "x", description: null, classification: "INTERNAL" },
    { title: "Synthetic", description: null, classification: "TOP_SECRET" },
  ])("rejects mass assignment or invalid Case input", (body) => {
    expect(
      parseMutationInput(
        "UPDATE_CASE",
        JSON.stringify(body),
        headers({
          "content-type": "application/json",
          "if-match": '"1"',
        }),
      ),
    ).toBeNull();
  });

  it("requires exact optimistic concurrency and empty transition body", () => {
    expect(
      parseMutationInput("TRANSITION_CASE", "", headers({ "if-match": '"2"' })),
    ).toEqual({ revision: 2 });
    expect(
      parseMutationInput("TRANSITION_CASE", "{}", headers({ "if-match": '"2"' })),
    ).toBeNull();
    expect(
      parseMutationInput("TRANSITION_CASE", "", headers({ "if-match": "2" })),
    ).toBeNull();
  });

  it("rejects oversized bodies and missing idempotency keys", () => {
    expect(
      parseMutationInput("CREATE_INVESTIGATION", "x".repeat(8193), headers({})),
    ).toBeNull();
    expect(
      parseMutationInput(
        "CREATE_INVESTIGATION",
        JSON.stringify({ title: "Branch", objective: "Objective" }),
        headers({ "content-type": "application/json" }),
      ),
    ).toBeNull();
  });
});
