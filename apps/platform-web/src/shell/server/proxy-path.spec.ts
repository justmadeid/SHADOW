import { describe, expect, it } from "vitest";
import { mutationPath, proxyPath } from "./proxy-path";
const id = "01900000-0000-7000-8000-000000000001";
describe("read-only BFF path allowlist", () => {
  it("permits canonical bounded list and detail reads", () => {
    expect(proxyPath(["cases"], new URLSearchParams({ workspaceId: id }))).toBe(
      `/cases?workspaceId=${id}`,
    );
    expect(proxyPath(["cases", id, "access"], new URLSearchParams())).toBe(
      `/cases/${id}/access`,
    );
    expect(proxyPath(["cases", id, "investigations"], new URLSearchParams())).toBe(
      `/cases/${id}/investigations`,
    );
    expect(proxyPath(["cases", id, "subjects"], new URLSearchParams())).toBe(
      `/cases/${id}/subjects`,
    );
    expect(
      proxyPath(["resolutions", id, "candidates"], new URLSearchParams("limit=50")),
    ).toBe(`/resolutions/${id}/candidates?limit=50`);
    expect(proxyPath(["subjects", id, "resolution"], new URLSearchParams())).toBe(
      `/subjects/${id}/resolution`,
    );
    expect(proxyPath(["shadow", "cases", id, "targets", id], new URLSearchParams())).toBe(
      `/shadow/cases/${id}/targets/${id}`,
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
  it("permits only explicit Case and Investigation mutations", () => {
    expect(mutationPath("POST", ["cases"])).toBe("CREATE_CASE");
    expect(mutationPath("PATCH", ["cases", id])).toBe("UPDATE_CASE");
    expect(mutationPath("POST", ["cases", id, "actions", "close"])).toBe(
      "TRANSITION_CASE",
    );
    expect(mutationPath("POST", ["cases", id, "investigations"])).toBe(
      "CREATE_INVESTIGATION",
    );
    expect(mutationPath("POST", ["cases", id, "subjects"])).toBe("CREATE_SUBJECT");
    expect(mutationPath("POST", ["subjects", id, "actions", "start-resolution"])).toBe(
      "START_RESOLUTION",
    );
    expect(mutationPath("POST", ["candidates", id, "actions", "resolve"])).toBe(
      "RESOLVE_CANDIDATE",
    );
    expect(mutationPath("POST", ["cases", id, "members"])).toBeNull();
    expect(mutationPath("POST", ["cases", id, "actions", "delete"])).toBeNull();
  });
});
