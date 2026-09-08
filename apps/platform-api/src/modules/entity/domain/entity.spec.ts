import { describe, expect, it } from "vitest";
import {
  addEntityAlias,
  archiveEntity,
  createEntity,
  mergeEntities,
  normalizeCreateEntity,
  renameEntity,
  type EntityAlias,
} from "./entity.js";

const entityId = "01900000-0000-7000-8000-000000000001";
const workspaceId = "01900000-0000-7000-8000-000000000002";
const aliasId = "01900000-0000-7000-8000-000000000003";
const now = new Date("2026-09-07T00:00:00Z");
const alias = (id: string, label: string): EntityAlias => ({
  id,
  label,
  createdAt: now.toISOString(),
});
function active() {
  return createEntity(
    {
      id: entityId,
      workspaceId,
      type: "PERSON",
      canonicalLabel: "Synthetic Person",
      aliases: [alias(aliasId, "Test Person")],
    },
    now,
  );
}

describe("Entity Registry domain", () => {
  it("normalizes a thin identity and rejects duplicate aliases", () => {
    expect(
      normalizeCreateEntity({
        type: "PERSON",
        canonicalLabel: "  Synthetic   Person ",
        aliases: ["Zed", "alpha"],
      }),
    ).toEqual({
      type: "PERSON",
      canonicalLabel: "Synthetic Person",
      aliases: ["alpha", "Zed"],
    });
    expect(() =>
      normalizeCreateEntity({
        type: "PERSON",
        canonicalLabel: "Synthetic Person",
        aliases: ["synthetic person"],
      }),
    ).toThrow();
  });

  it("creates a deeply immutable active Workspace identity", () => {
    const value = active();
    expect(value).toMatchObject({
      id: entityId,
      workspaceId,
      type: "PERSON",
      status: "ACTIVE",
      canonicalLabel: "Synthetic Person",
      mergedInto: null,
      revision: 1,
    });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.aliases)).toBe(true);
    expect(Object.isFrozen(value.aliases[0])).toBe(true);
  });

  it("renames non-destructively and retains the previous canonical label as an alias", () => {
    const changed = renameEntity(
      active(),
      "Canonical Person",
      alias("01900000-0000-7000-8000-000000000004", "Synthetic Person"),
      1,
      new Date("2026-09-07T00:01:00Z"),
    );
    expect(changed.canonicalLabel).toBe("Canonical Person");
    expect(changed.aliases.map((value) => value.label)).toEqual([
      "Test Person",
      "Synthetic Person",
    ]);
    expect(changed.revision).toBe(2);
  });

  it("adds unique aliases and rejects canonical or existing names", () => {
    const value = active();
    expect(
      addEntityAlias(
        value,
        alias("01900000-0000-7000-8000-000000000004", "S. Person"),
        1,
        now,
      ).aliases,
    ).toHaveLength(2);
    for (const label of ["synthetic person", "TEST PERSON"])
      expect(() =>
        addEntityAlias(
          value,
          alias("01900000-0000-7000-8000-000000000004", label),
          1,
          now,
        ),
      ).toThrow();
  });

  it("archives without deleting identity and makes the lifecycle terminal", () => {
    const archived = archiveEntity(active(), 1, now);
    expect(archived).toMatchObject({ status: "ARCHIVED", revision: 2 });
    expect(archived.aliases).toHaveLength(1);
    expect(() => archiveEntity(archived, 2, now)).toThrow();
  });

  it("merges two active same-Workspace identities without destroying either history", () => {
    const survivor = active();
    const absorbed = createEntity(
      {
        id: "01900000-0000-7000-8000-000000000005",
        workspaceId,
        type: "PERSON",
        canonicalLabel: "Duplicate Person",
        aliases: [],
      },
      now,
    );
    const merged = mergeEntities(
      survivor,
      absorbed,
      1,
      1,
      new Date("2026-09-07T00:02:00Z"),
    );
    expect(merged.survivor).toMatchObject({
      id: survivor.id,
      status: "ACTIVE",
      revision: 2,
      mergedInto: null,
    });
    expect(merged.absorbed).toMatchObject({
      id: absorbed.id,
      status: "MERGED",
      revision: 2,
      mergedInto: { id: survivor.id, workspaceId },
    });
    expect(Object.isFrozen(merged.absorbed.mergedInto)).toBe(true);
  });

  it("rejects self, stale, inactive, cross-Workspace and cross-type merges", () => {
    const value = active();
    const duplicate = createEntity(
      {
        id: "01900000-0000-7000-8000-000000000005",
        workspaceId,
        type: "PERSON",
        canonicalLabel: "Duplicate Person",
        aliases: [],
      },
      now,
    );
    expect(() => mergeEntities(value, value, 1, 1, now)).toThrow();
    expect(() => mergeEntities(value, duplicate, 2, 1, now)).toThrow();
    expect(() =>
      mergeEntities(archiveEntity(value, 1, now), duplicate, 2, 1, now),
    ).toThrow();
    expect(() =>
      mergeEntities(
        value,
        { ...duplicate, workspaceId: "01900000-0000-7000-8000-000000000006" },
        1,
        1,
        now,
      ),
    ).toThrow();
    expect(() =>
      mergeEntities(value, { ...duplicate, type: "ORGANIZATION" }, 1, 1, now),
    ).toThrow();
  });

  it("rejects invalid IDs, enums, clocks, labels, bounds and stale revisions", () => {
    expect(() =>
      createEntity(
        {
          id: "invalid",
          workspaceId,
          type: "PERSON",
          canonicalLabel: "Synthetic",
          aliases: [],
        },
        now,
      ),
    ).toThrow();
    for (const canonicalLabel of ["", "x".repeat(201), "unsafe\u0000label"])
      expect(() => normalizeCreateEntity({ type: "PERSON", canonicalLabel })).toThrow();
    expect(() => archiveEntity(active(), 2, now)).toThrow();
    expect(() =>
      normalizeCreateEntity({
        type: "PERSON",
        canonicalLabel: "Synthetic",
        aliases: Array.from({ length: 21 }, (_, index) => `Alias ${index}`),
      }),
    ).toThrow();
  });
});
