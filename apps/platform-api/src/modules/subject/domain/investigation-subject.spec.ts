import { describe, expect, it, vi } from "vitest";
import {
  archiveSubject,
  createSubject,
  failSubjectResolution,
  resolveSubject,
  startSubjectResolution,
  updateSubjectRole,
  type CanonicalEntityResolver,
  type SubjectRole,
  type SubjectType,
} from "./investigation-subject.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const caseId = "01900000-0000-7000-8000-000000000002";
const subjectId = "01900000-0000-7000-8000-000000000003";
const entityId = "01900000-0000-7000-8000-000000000004";
const now = new Date("2026-09-07T00:00:00.000Z");
const input = {
  id: subjectId,
  workspaceId,
  caseId,
  subjectType: "PERSON" as const,
  role: "PRIMARY_TARGET" as const,
};
const subject = () => createSubject(input, now);
const resolving = () => startSubjectResolution(subject(), 1, now);
const resolver = (
  value: Awaited<ReturnType<CanonicalEntityResolver["resolve"]>> = {
    id: entityId,
    workspaceId,
    type: "PERSON",
    status: "ACTIVE",
  },
): CanonicalEntityResolver => ({ resolve: vi.fn().mockResolvedValue(value) });

describe("InvestigationSubject domain baseline", () => {
  it("creates immutable unresolved Case context without identity or seed values", () => {
    const value = subject();
    expect(value).toMatchObject({
      id: subjectId,
      workspaceId,
      caseId,
      investigationId: null,
      status: "UNRESOLVED",
      entityRef: null,
      revision: 1,
    });
    expect(Object.isFrozen(value)).toBe(true);
    expect(value).not.toHaveProperty("seed");
  });
  it("does not mass assign identity or status at creation", () => {
    const extra = { ...input, status: "RESOLVED", entityRef: { id: entityId } };
    expect(createSubject(extra, now)).toMatchObject({
      status: "UNRESOLVED",
      entityRef: null,
    });
  });
  it.each(["id", "workspaceId", "caseId", "investigationId"] as const)(
    "rejects invalid %s",
    (field) => {
      expect(() => createSubject({ ...input, [field]: "invalid" }, now)).toThrow();
    },
  );
  it("rejects unknown enums and invalid clocks", () => {
    expect(() =>
      createSubject({ ...input, subjectType: "DEVICE" as SubjectType }, now),
    ).toThrow();
    expect(() =>
      createSubject({ ...input, role: "ADMIN" as SubjectRole }, now),
    ).toThrow();
    expect(() => createSubject(input, new Date(NaN))).toThrow();
  });
  it("updates Case-specific role without mutating the previous revision", () => {
    const original = subject();
    expect(updateSubjectRole(original, "WITNESS", 1, now)).toMatchObject({
      role: "WITNESS",
      revision: 2,
    });
    expect(original.role).toBe("PRIMARY_TARGET");
  });
  it("preserves failed resolution and allows an explicit retry", () => {
    const failed = failSubjectResolution(resolving(), 2, now);
    expect(failed).toMatchObject({
      status: "RESOLUTION_FAILED",
      entityRef: null,
      revision: 3,
    });
    expect(startSubjectResolution(failed, 3, now)).toMatchObject({
      status: "RESOLVING",
      revision: 4,
    });
  });
  it("rejects invalid transitions and stale revisions before any Registry lookup", async () => {
    const registry = resolver();
    await expect(
      resolveSubject(subject(), entityId, registry, 1, now),
    ).rejects.toMatchObject({ code: "SUBJECT_INVALID_STATUS_TRANSITION" });
    await expect(
      resolveSubject(resolving(), entityId, registry, 1, now),
    ).rejects.toThrow();
    expect(registry.resolve).not.toHaveBeenCalled();
    expect(() => startSubjectResolution(resolving(), 2, now)).toThrow();
    expect(() => failSubjectResolution(subject(), 1, now)).toThrow();
  });
  it("accepts only the canonical reference returned by the trusted Registry", async () => {
    const registry = resolver();
    const resolved = await resolveSubject(resolving(), entityId, registry, 2, now);
    expect(registry.resolve).toHaveBeenCalledWith(workspaceId, entityId);
    expect(resolved).toMatchObject({
      status: "RESOLVED",
      revision: 3,
      entityRef: { type: "ENTITY", id: entityId, workspaceId },
    });
    expect(Object.isFrozen(resolved.entityRef)).toBe(true);
    expect(() => startSubjectResolution(resolved, 3, now)).toThrow();
  });
  it.each([
    null,
    { id: entityId, workspaceId: caseId, type: "PERSON", status: "ACTIVE" as const },
    { id: entityId, workspaceId, type: "ORGANIZATION", status: "ACTIVE" as const },
    { id: "invalid", workspaceId, type: "PERSON", status: "ACTIVE" as const },
  ])(
    "rejects missing, cross-workspace or incompatible canonical Entity",
    async (canonical) => {
      const current = resolving();
      await expect(
        resolveSubject(current, entityId, resolver(canonical), 2, now),
      ).rejects.toMatchObject({ code: "SUBJECT_CANONICAL_ENTITY_REQUIRED" });
      expect(current).toMatchObject({
        status: "RESOLVING",
        entityRef: null,
        revision: 2,
      });
    },
  );
  it("retains canonical survivor IDs returned for merged Entity IDs", async () => {
    const survivorId = "01900000-0000-7000-8000-000000000005";
    const registry = resolver({
      id: survivorId,
      workspaceId,
      type: "PERSON",
      status: "ACTIVE",
    });
    expect(
      (await resolveSubject(resolving(), entityId, registry, 2, now)).entityRef?.id,
    ).toBe(survivorId);
  });
  it("propagates Registry failure without creating a half-resolved value", async () => {
    const registry = { resolve: vi.fn().mockRejectedValue(new Error("Unavailable")) };
    await expect(resolveSubject(resolving(), entityId, registry, 2, now)).rejects.toThrow(
      "Unavailable",
    );
  });
  it("archives resolved context without deleting the identity linkage", async () => {
    const resolved = await resolveSubject(resolving(), entityId, resolver(), 2, now);
    const archived = archiveSubject(resolved, 3, now);
    expect(archived).toMatchObject({
      status: "ARCHIVED",
      revision: 4,
      entityRef: resolved.entityRef,
    });
    expect(() => updateSubjectRole(archived, "WITNESS", 4, now)).toThrow();
    expect(() => archiveSubject(archived, 4, now)).toThrow();
    await expect(
      resolveSubject(archived, entityId, resolver(), 4, now),
    ).rejects.toThrow();
  });
  it("rejects backwards time and stale metadata edits", () => {
    expect(() =>
      updateSubjectRole(subject(), "WITNESS", 1, new Date("2025-01-01")),
    ).toThrow();
    expect(() => updateSubjectRole(subject(), "WITNESS", 2, now)).toThrow();
  });
});
