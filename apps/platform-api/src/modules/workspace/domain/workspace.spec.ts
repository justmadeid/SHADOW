import { describe, expect, it } from "vitest";

import { validateCreateWorkspaceInput } from "./workspace.js";

describe("Workspace input", () => {
  it("normalizes canonical name, slug, locale, and time zone", () => {
    expect(
      validateCreateWorkspaceInput({
        name: "  Investigation Team  ",
        slug: "  INVESTIGATION-TEAM  ",
        locale: "id-ID",
        timeZone: "Asia/Jakarta",
      }),
    ).toEqual({
      name: "Investigation Team",
      slug: "investigation-team",
      locale: "id-ID",
      timeZone: "Asia/Jakarta",
    });
  });

  it.each([
    ["short name", { name: "x" }],
    ["invalid slug", { slug: "Not Valid" }],
    ["invalid locale", { locale: "not_a_locale" }],
    ["invalid time zone", { timeZone: "Jakarta" }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      validateCreateWorkspaceInput({
        name: "Investigation Team",
        slug: "investigation-team",
        locale: "id-ID",
        timeZone: "Asia/Jakarta",
        ...override,
      }),
    ).toThrow();
  });
});
