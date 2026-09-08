import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createEntity } from "./entity.js";
import {
  parseCreateEntity,
  parseMergeEntity,
  parseUpdateEntity,
} from "./entity-input.js";

describe("Entity public contract", () => {
  it("accepts identity-only creation fields", () => {
    expect(
      parseCreateEntity({
        type: "ORGANIZATION",
        canonicalLabel: "Synthetic Organization",
        aliases: ["Synthetic Org"],
      }),
    ).toEqual({
      type: "ORGANIZATION",
      canonicalLabel: "Synthetic Organization",
      aliases: ["Synthetic Org"],
    });
    for (const extra of [
      { allegation: "untrusted" },
      { employer: "untrusted" },
      { caseId: "01900000-0000-7000-8000-000000000009" },
      { identifiers: [] },
      { status: "ACTIVE" },
      { mergedInto: null },
    ])
      expect(() =>
        parseCreateEntity({
          type: "PERSON",
          canonicalLabel: "Synthetic",
          ...extra,
        }),
      ).toThrow();
  });

  it("accepts exactly one non-destructive identity command", () => {
    expect(parseUpdateEntity({ canonicalLabel: "New Label" })).toEqual({
      canonicalLabel: "New Label",
    });
    expect(parseUpdateEntity({ alias: "New Alias" })).toEqual({ alias: "New Alias" });
    expect(parseUpdateEntity({ status: "ARCHIVED" })).toEqual({ status: "ARCHIVED" });
    for (const input of [
      {},
      { status: "MERGED" },
      { type: "ORGANIZATION" },
      { alias: "A", canonicalLabel: "B" },
      { workspaceId: "scope" },
    ])
      expect(() => parseUpdateEntity(input)).toThrow();
  });

  it("serializes only thin identity fields", () => {
    const value = createEntity(
      {
        id: "01900000-0000-7000-8000-000000000001",
        workspaceId: "01900000-0000-7000-8000-000000000002",
        type: "PERSON",
        canonicalLabel: "Synthetic",
        aliases: [],
      },
      new Date("2026-09-07T00:00:00Z"),
    );
    expect(Object.keys(JSON.parse(JSON.stringify(value))).sort()).toEqual(
      [
        "id",
        "workspaceId",
        "type",
        "status",
        "canonicalLabel",
        "aliases",
        "mergedInto",
        "revision",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });

  it("accepts only a bounded merge command and exposes its OpenAPI operation", () => {
    const absorbedEntityId = "01900000-0000-7000-8000-000000000009";
    expect(
      parseMergeEntity({
        absorbedEntityId,
        absorbedRevision: 3,
        reasonCode: "DUPLICATE_IDENTITY",
      }),
    ).toEqual({
      absorbedEntityId,
      absorbedRevision: 3,
      reasonCode: "DUPLICATE_IDENTITY",
    });
    for (const input of [
      {},
      { absorbedEntityId: "invalid", absorbedRevision: 1, reasonCode: "MANUAL_REVIEW" },
      { absorbedEntityId, absorbedRevision: 0, reasonCode: "MANUAL_REVIEW" },
      { absorbedEntityId, absorbedRevision: 1, reasonCode: "FREE_TEXT" },
      {
        absorbedEntityId,
        absorbedRevision: 1,
        reasonCode: "MANUAL_REVIEW",
        canonicalLabel: "Injected",
      },
    ])
      expect(() => parseMergeEntity(input)).toThrow();
    const contract = fs.readFileSync(
      new URL("../../../../../../docs/contracts/platform-api-v1.yaml", import.meta.url),
      "utf8",
    );
    expect(contract).toContain("operationId: mergeEntity");
    expect(contract).toContain('$ref: "#/components/schemas/EntityMergeDecision"');
  });
});
