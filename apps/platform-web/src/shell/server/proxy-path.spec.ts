import { describe, expect, it } from "vitest";
import { proxyPath } from "./proxy-path";
const id = "01900000-0000-7000-8000-000000000001";
describe("read-only BFF path allowlist", () => {
  it("permits canonical bounded list and detail reads", () => {
    expect(proxyPath(["cases"], new URLSearchParams({ workspaceId: id }))).toBe(
      `/cases?workspaceId=${id}`,
    );
    expect(proxyPath(["cases", id, "access"], new URLSearchParams())).toBe(
      `/cases/${id}/access`,
    );
  });
  it.each([
    ["internal", "v1", "runs"],
    ["https:", "evil.test"],
    ["cases", ".."],
    ["cases", id, "actions", "close"],
    ["workspaces", id, "members"],
  ])("rejects arbitrary destinations %j", (...path) => {
    expect(proxyPath(path, new URLSearchParams())).toBeNull();
  });
  it("rejects extra or duplicate query parameters", () => {
    expect(
      proxyPath(["cases"], new URLSearchParams(`workspaceId=${id}&workspaceId=${id}`)),
    ).toBeNull();
    expect(proxyPath(["workspaces"], new URLSearchParams("token=private"))).toBeNull();
  });
});
