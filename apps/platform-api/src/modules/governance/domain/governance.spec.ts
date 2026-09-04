import { describe, expect, it } from "vitest";

import {
  permissionRequiresReason,
  scopeMatches,
  validateRoleDefinition,
} from "./governance.js";

describe("Governance policy model", () => {
  const caseResource = {
    type: "EVIDENCE" as const,
    id: "01992028-0000-7000-8000-000000000003",
    workspaceId: "01992028-0000-7000-8000-000000000001",
  };

  it("models workspace, case, and exact-resource scopes independently", () => {
    expect(scopeMatches({ type: "WORKSPACE" }, caseResource)).toBe(true);
    expect(
      scopeMatches(
        {
          type: "CASE",
          resourceId: "01992028-0000-7000-8000-000000000002",
        },
        caseResource,
        { caseId: "01992028-0000-7000-8000-000000000002" },
      ),
    ).toBe(true);
    expect(
      scopeMatches(
        {
          type: "CASE",
          resourceId: "01992028-0000-7000-8000-000000000099",
        },
        caseResource,
        { caseId: "01992028-0000-7000-8000-000000000002" },
      ),
    ).toBe(false);
    expect(
      scopeMatches(
        { type: "RESOURCE", resourceType: "EVIDENCE", resourceId: caseResource.id },
        caseResource,
      ),
    ).toBe(true);
  });

  it("keeps permission-to-use distinct from permission-to-view", () => {
    const role = validateRoleDefinition({
      key: "RESTRICTED_OPERATOR",
      name: "Restricted operator",
      permissions: ["IDENTIFIER_USE_RESTRICTED"],
    });

    expect(role.permissions).toEqual(["IDENTIFIER_USE_RESTRICTED"]);
    expect(role.permissions).not.toContain("IDENTIFIER_VIEW_RESTRICTED");
    expect(permissionRequiresReason("IDENTIFIER_USE_RESTRICTED")).toBe(true);
    expect(permissionRequiresReason("CASE_VIEW")).toBe(false);
  });

  it("normalizes role keys and removes duplicate permissions", () => {
    expect(
      validateRoleDefinition({
        key: " analyst ",
        name: " Analyst ",
        permissions: ["CASE_VIEW", "CASE_VIEW", "CASE_UPDATE"],
      }),
    ).toMatchObject({
      key: "ANALYST",
      name: "Analyst",
      permissions: ["CASE_UPDATE", "CASE_VIEW"],
    });
  });
});
