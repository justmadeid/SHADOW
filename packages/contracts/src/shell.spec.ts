import { describe, expect, it } from "vitest";
import { parseShellContext, productHref, safeReturnTo } from "./shell.js";
const workspaceId = "01900000-0000-7000-8000-000000000001";
const caseId = "01900000-0000-7000-8000-000000000002";
describe("shared shell navigation", () => {
  it("preserves only canonical context across products", () => {
    expect(productHref("ECHO", { workspaceId, caseId })).toBe(
      `/echo?workspaceId=${workspaceId}&caseId=${caseId}`,
    );
    expect(
      safeReturnTo(
        `/shadow?workspaceId=${workspaceId}&caseId=${caseId}&token=private&view=canvas`,
      ),
    ).toBe(`/shadow?workspaceId=${workspaceId}&caseId=${caseId}`);
  });
  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/auth/callback",
    "/echo?caseId=bad",
    "/shadow?workspaceId=bad",
    `/shadow?caseId=${caseId}`,
    `/shadow?workspaceId=${workspaceId}&workspaceId=${workspaceId}`,
  ])("rejects unsafe or inconsistent return targets: %s", (value) => {
    expect(safeReturnTo(value)).toBe("/shadow");
  });
  it("rejects orphan Case context and duplicate parameters", () => {
    expect(() => parseShellContext(new URLSearchParams({ caseId }))).toThrow();
    expect(() => productHref("SHADOW", { caseId })).toThrow();
  });
});
