import { describe, expect, it } from "vitest";
import {
  CASE_ROLE_PERMISSIONS,
  validateMembershipInput,
  type CaseRole,
} from "./case-membership.js";

describe("Case membership", () => {
  it("separates viewer, editor, and owner capabilities without granting identifier use", () => {
    expect(CASE_ROLE_PERMISSIONS.VIEWER).toEqual(["CASE_VIEW", "INVESTIGATION_VIEW"]);
    expect(CASE_ROLE_PERMISSIONS.EDITOR).toContain("CASE_UPDATE");
    expect(CASE_ROLE_PERMISSIONS.EDITOR).not.toContain("GOVERNANCE_ROLE_MANAGE");
    expect(CASE_ROLE_PERMISSIONS.OWNER).toContain("GOVERNANCE_ROLE_MANAGE");
    for (const permissions of Object.values(CASE_ROLE_PERMISSIONS)) {
      expect(permissions).not.toContain("IDENTIFIER_USE_RESTRICTED");
      expect(permissions).not.toContain("IDENTIFIER_VIEW_RESTRICTED");
      expect(permissions).not.toContain("DISCOVER_ENTITY_EXISTENCE");
    }
  });
  it.each([
    [" ", "VIEWER", "Review"],
    ["a".repeat(256), "VIEWER", "Review"],
    ["user", "ADMIN", "Review"],
    ["user", "EDITOR", " "],
    ["user", "OWNER", "a".repeat(1001)],
  ])("rejects invalid membership input %#", (userId, role, reason) => {
    expect(() => validateMembershipInput(userId!, role as CaseRole, reason!)).toThrow(
      expect.objectContaining({ code: "VALIDATION_CASE_MEMBERSHIP_INVALID" }),
    );
  });
});
