import {
  DATA_CLASSIFICATIONS,
  isResourceId,
  type CaseAccess,
  type CaseDetail,
  type CaseSummary,
  type CasePage,
  type WorkspaceSummary,
  type InvestigationSummary,
  type Candidate,
  type CandidatePage,
  type Entity,
  type EntityMatchPage,
  type IdentifierView,
  type InvestigationSubject,
  type ResolutionSession,
  type SubjectPage,
  type SubjectSeed,
  type TargetProfileView,
  type ClassifiedFieldView,
  FIELD_VISIBILITIES,
  SUBJECT_ROLES,
  SUBJECT_SEED_FIELD_NAMES,
  SUBJECT_TYPES,
} from "@intelligence/contracts";
function invalid(): never {
  throw new Error("Invalid API response");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 255): string {
  if (typeof value !== "string" || !value.length || value.length > max) return invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (!isResourceId(result)) return invalid();
  return result;
}
export function parseWorkspace(value: unknown): WorkspaceSummary {
  const r = record(value);
  return { id: id(r.id), name: text(r.name, 200) };
}
export function parseWorkspaces(value: unknown) {
  const r = record(value);
  if (!Array.isArray(r.items) || r.items.length > 100) return invalid();
  return { items: r.items.map(parseWorkspace) };
}
export function parseSession(value: unknown) {
  const r = record(value);
  const user = record(r.user);
  if (typeof r.expiresAt !== "number" || !Number.isSafeInteger(r.expiresAt))
    return invalid();
  return { user: { id: text(user.id) }, expiresAt: r.expiresAt };
}
export function parseCase(value: unknown): CaseSummary {
  const r = record(value);
  if (
    !DATA_CLASSIFICATIONS.some((c) => c === r.classification) ||
    !["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"].includes(String(r.status)) ||
    typeof r.revision !== "number" ||
    !Number.isSafeInteger(r.revision) ||
    r.revision < 1
  )
    return invalid();
  return {
    id: id(r.id),
    workspaceId: id(r.workspaceId),
    code: text(r.code),
    title: text(r.title, 200),
    classification: r.classification as CaseSummary["classification"],
    status: r.status as CaseSummary["status"],
    revision: r.revision,
  };
}
function instant(value: unknown): string {
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) return invalid();
  return result;
}
function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    return invalid();
  return value;
}
function nullableId(value: unknown): string | null {
  return value === null ? null : id(value);
}
export function parseCaseDetail(value: unknown): CaseDetail {
  const r = record(value);
  return {
    ...parseCase(value),
    description: r.description === null ? null : text(r.description, 4000),
    createdAt: instant(r.createdAt),
    updatedAt: instant(r.updatedAt),
    closedAt: nullableInstant(r.closedAt),
    archivedAt: nullableInstant(r.archivedAt),
  };
}
export function parseCasePage(value: unknown): CasePage {
  const r = record(value);
  const page = record(r.page);
  if (
    !Array.isArray(r.items) ||
    r.items.length > 100 ||
    typeof page.hasMore !== "boolean" ||
    !(page.nextCursor === null || typeof page.nextCursor === "string") ||
    (page.hasMore && !page.nextCursor)
  )
    return invalid();
  return {
    items: r.items.map(parseCase),
    page: {
      hasMore: page.hasMore,
      nextCursor: page.nextCursor === null ? null : text(page.nextCursor, 2048),
    },
  };
}
export function parseCaseAccess(value: unknown): CaseAccess {
  const r = record(value);
  const p = record(r.permissions);
  for (const key of ["view", "update", "createInvestigation", "manageMembers"])
    if (typeof p[key] !== "boolean") return invalid();
  return {
    caseId: id(r.caseId),
    workspaceId: id(r.workspaceId),
    permissions: {
      view: p.view as boolean,
      update: p.update as boolean,
      createInvestigation: p.createInvestigation as boolean,
      manageMembers: p.manageMembers as boolean,
    },
  };
}
export function parseInvestigation(value: unknown): InvestigationSummary {
  const r = record(value);
  if (
    !["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].includes(String(r.status)) ||
    typeof r.revision !== "number" ||
    !Number.isSafeInteger(r.revision) ||
    r.revision < 1
  )
    return invalid();
  return {
    id: id(r.id),
    workspaceId: id(r.workspaceId),
    caseId: id(r.caseId),
    title: text(r.title, 200),
    objective: text(r.objective, 2000),
    status: r.status as InvestigationSummary["status"],
    revision: r.revision,
    createdAt: instant(r.createdAt),
    updatedAt: instant(r.updatedAt),
    completedAt: nullableInstant(r.completedAt),
    archivedAt: nullableInstant(r.archivedAt),
  };
}
export function parseInvestigations(value: unknown) {
  const r = record(value);
  if (!Array.isArray(r.items) || r.items.length > 100) return invalid();
  return { items: r.items.map(parseInvestigation) };
}

export function parseSubject(value: unknown): InvestigationSubject {
  const r = record(value);
  if (
    !SUBJECT_TYPES.includes(r.subjectType as never) ||
    !SUBJECT_ROLES.includes(r.role as never) ||
    !["UNRESOLVED", "RESOLVING", "RESOLVED", "RESOLUTION_FAILED", "ARCHIVED"].includes(
      String(r.status),
    )
  )
    return invalid();
  const entity = r.entityRef === null ? null : record(r.entityRef);
  const seed = r.seed === null ? null : record(r.seed);
  return {
    id: id(r.id),
    workspaceId: id(r.workspaceId),
    caseId: id(r.caseId),
    investigationId: nullableId(r.investigationId),
    subjectType: r.subjectType as InvestigationSubject["subjectType"],
    role: r.role as InvestigationSubject["role"],
    status: r.status as InvestigationSubject["status"],
    entityRef: entity
      ? {
          type: entity.type === "ENTITY" ? "ENTITY" : invalid(),
          id: id(entity.id),
          workspaceId: id(entity.workspaceId),
        }
      : null,
    seed: seed
      ? {
          id: id(seed.id),
          fieldCount:
            typeof seed.fieldCount === "number" &&
            Number.isSafeInteger(seed.fieldCount) &&
            seed.fieldCount >= 1 &&
            seed.fieldCount <= 20
              ? seed.fieldCount
              : invalid(),
        }
      : null,
    revision: revision(r.revision),
    createdAt: instant(r.createdAt),
    updatedAt: instant(r.updatedAt),
  };
}

export function parseSubjectPage(value: unknown): SubjectPage {
  const r = record(value);
  const page = parsePage(r.page);
  if (!Array.isArray(r.items) || r.items.length > 100) return invalid();
  return { items: r.items.map(parseSubject), page };
}

export function parseSubjectSeed(value: unknown): SubjectSeed {
  const r = record(value);
  if (!Array.isArray(r.fields) || r.fields.length < 1 || r.fields.length > 20)
    return invalid();
  return {
    id: id(r.id),
    subjectId: id(r.subjectId),
    workspaceId: id(r.workspaceId),
    caseId: id(r.caseId),
    createdAt: instant(r.createdAt),
    fields: r.fields.map((value) => {
      const f = record(value);
      if (
        !SUBJECT_SEED_FIELD_NAMES.includes(f.name as never) ||
        typeof f.ordinal !== "number" ||
        !Number.isSafeInteger(f.ordinal) ||
        !DATA_CLASSIFICATIONS.includes(f.classification as never) ||
        f.evidenceRef !== null ||
        f.sourceRecordRef !== null
      )
        return invalid();
      return {
        id: id(f.id),
        ordinal: f.ordinal,
        name: f.name as SubjectSeed["fields"][number]["name"],
        origin: text(f.origin),
        classification:
          f.classification as SubjectSeed["fields"][number]["classification"],
        evidenceRef: null,
        sourceRecordRef: null,
        value: parseClassifiedField(f.value),
      };
    }),
  };
}

export function parseResolutionSession(value: unknown): ResolutionSession {
  const r = record(value);
  if (
    !["SEARCHING", "NEEDS_REVIEW", "RESOLVED", "CLOSED"].includes(String(r.status)) ||
    typeof r.candidatesCount !== "number" ||
    !Number.isSafeInteger(r.candidatesCount) ||
    r.candidatesCount < 0
  )
    return invalid();
  return {
    id: id(r.id),
    subjectId: id(r.subjectId),
    workspaceId: id(r.workspaceId),
    caseId: id(r.caseId),
    status: r.status as ResolutionSession["status"],
    candidatesCount: r.candidatesCount,
    selectedCandidateId: nullableId(r.selectedCandidateId),
    resolutionDecisionId: nullableId(r.resolutionDecisionId),
    revision: revision(r.revision),
    createdAt: instant(r.createdAt),
    updatedAt: instant(r.updatedAt),
  };
}

export function parseStartResolution(value: unknown) {
  const r = record(value);
  return {
    resolution: parseResolutionSession(r.resolution),
    subject: parseSubject(r.subject),
  };
}

export function parseCandidate(value: unknown): Candidate {
  const r = record(value);
  if (
    !["PERSON", "ORGANIZATION", "SOCIAL_ACCOUNT", "DOMAIN"].includes(String(r.type)) ||
    !["PENDING_REVIEW", "RESOLVED", "REJECTED", "UNCERTAIN"].includes(String(r.status)) ||
    !DATA_CLASSIFICATIONS.includes(r.classification as never)
  )
    return invalid();
  const source = record(r.source);
  if (!Array.isArray(r.evidenceRefs) || r.evidenceRefs.length > 20) return invalid();
  return {
    id: id(r.id),
    resolutionSessionId: id(r.resolutionSessionId),
    subjectId: id(r.subjectId),
    workspaceId: id(r.workspaceId),
    caseId: id(r.caseId),
    type: r.type as Candidate["type"],
    status: r.status as Candidate["status"],
    displayLabel: text(r.displayLabel, 200),
    classification: r.classification as Candidate["classification"],
    source: {
      origin: text(source.origin),
      resource: source.resource === null ? null : parseResourceRef(source.resource),
    },
    evidenceRefs: r.evidenceRefs.map(parseResourceRef),
    revision: revision(r.revision),
    createdAt: instant(r.createdAt),
    updatedAt: instant(r.updatedAt),
  };
}

export function parseCandidatePage(value: unknown): CandidatePage {
  const r = record(value);
  if (!Array.isArray(r.items) || r.items.length > 100) return invalid();
  return { items: r.items.map(parseCandidate), page: parsePage(r.page) };
}

export function parseEntityMatchPage(value: unknown): EntityMatchPage {
  const r = record(value);
  if (!Array.isArray(r.items) || r.items.length > 100) return invalid();
  return {
    items: r.items.map((value) => {
      const m = record(value);
      if (!Array.isArray(m.signals) || !Array.isArray(m.conflicts)) return invalid();
      return {
        id: id(m.id),
        candidateId: id(m.candidateId),
        entityRef: parseEntityRef(m.entityRef),
        matchLevel: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"].includes(String(m.matchLevel))
          ? (m.matchLevel as EntityMatchPage["items"][number]["matchLevel"])
          : invalid(),
        signals: m.signals.map(parseMatchSignal),
        conflicts: m.conflicts.map(parseMatchSignal),
        crossCaseContext: parseCrossCaseContext(m.crossCaseContext),
        createdAt: instant(m.createdAt),
      };
    }),
    page: parsePage(r.page),
  };
}

export function parseTargetProfile(value: unknown): TargetProfileView {
  const r = record(value);
  const summary = record(r.identitySummary);
  const availability = record(r.sectionAvailability);
  const views = record(r.availableViews);
  const freshness = record(r.freshness);
  const entity = r.entity === null ? null : parseEntity(r.entity);
  if (
    !Array.isArray(summary.aliases) ||
    !Array.isArray(summary.identifiers) ||
    summary.identifiers.length > 100 ||
    summary.aliases.length > 100 ||
    views.overview !== true ||
    views.canvas !== false ||
    views.timeline !== false ||
    views.map !== false ||
    freshness.mode !== "CANONICAL" ||
    freshness.isStale !== false ||
    freshness.workspaceKnowledgeUpdatedAt !== null
  )
    return invalid();
  const sections = [
    "workspaceKnowledge",
    "sourceCoverage",
    "accounts",
    "evidence",
    "discoveries",
    "reviews",
    "searches",
  ] as const;
  for (const key of sections)
    if (!["AVAILABLE", "NOT_IMPLEMENTED"].includes(String(availability[key])))
      return invalid();
  return {
    id: id(r.id),
    workspaceId: id(r.workspaceId),
    caseId: id(r.caseId),
    subject: parseSubject(r.subject),
    entity,
    identitySummary: {
      displayLabel:
        summary.displayLabel === null ? null : text(summary.displayLabel, 200),
      type: text(summary.type) as TargetProfileView["identitySummary"]["type"],
      resolutionStatus: text(
        summary.resolutionStatus,
      ) as TargetProfileView["identitySummary"]["resolutionStatus"],
      aliases: summary.aliases.map(parseAlias),
      identifiers: summary.identifiers.map(parseIdentifier),
    },
    sectionAvailability: Object.fromEntries(
      sections.map((key) => [key, availability[key]]),
    ) as TargetProfileView["sectionAvailability"],
    availableViews: { overview: true, canvas: false, timeline: false, map: false },
    freshness: {
      mode: "CANONICAL",
      generatedAt: instant(freshness.generatedAt),
      sourceUpdatedAt: instant(freshness.sourceUpdatedAt),
      isStale: false,
      subjectRevision: revision(freshness.subjectRevision),
      entityRevision:
        freshness.entityRevision === null ? null : revision(freshness.entityRevision),
      latestIdentifierRevision:
        freshness.latestIdentifierRevision === null
          ? null
          : revision(freshness.latestIdentifierRevision),
      workspaceKnowledgeUpdatedAt: null,
    },
  };
}

export function parseCandidateResolution(value: unknown) {
  const r = record(value);
  return {
    candidate: parseCandidate(r.candidate),
    resolution: parseResolutionSession(r.resolution),
    subject: parseSubject(r.subject),
  };
}

function parsePage(value: unknown) {
  const p = record(value);
  if (
    typeof p.hasMore !== "boolean" ||
    !(p.nextCursor === null || typeof p.nextCursor === "string") ||
    (p.hasMore && !p.nextCursor)
  )
    return invalid();
  return {
    hasMore: p.hasMore,
    nextCursor: p.nextCursor === null ? null : text(p.nextCursor, 2048),
  };
}
function parseResourceRef(value: unknown) {
  const r = record(value);
  return {
    type: text(r.type),
    id: id(r.id),
    workspaceId: id(r.workspaceId),
    ...(r.caseId === undefined ? {} : { caseId: id(r.caseId) }),
  };
}
function parseEntityRef(value: unknown) {
  const r = record(value);
  return {
    type: r.type === "ENTITY" ? ("ENTITY" as const) : invalid(),
    id: id(r.id),
    workspaceId: id(r.workspaceId),
  };
}
function parseClassifiedField(value: unknown): ClassifiedFieldView {
  const r = record(value);
  if (
    !DATA_CLASSIFICATIONS.includes(r.classification as never) ||
    !FIELD_VISIBILITIES.includes(r.visibility as never)
  )
    return invalid();
  if (r.visibility === "FULL" || r.visibility === "MASKED")
    return {
      classification: r.classification as never,
      visibility: r.visibility as "FULL" | "MASKED",
      displayValue: text(r.displayValue, 2000),
    };
  if (
    r.visibility === "MATCH_ONLY" &&
    ["EXACT_MATCH", "NO_MATCH", "UNKNOWN"].includes(String(r.matchStatus))
  )
    return {
      classification: r.classification as never,
      visibility: "MATCH_ONLY" as const,
      matchStatus: r.matchStatus as "EXACT_MATCH" | "NO_MATCH" | "UNKNOWN",
    };
  if (r.visibility === "HIDDEN")
    return { classification: r.classification as never, visibility: "HIDDEN" as const };
  return invalid();
}
function parseEntity(value: unknown): Entity {
  const r = record(value);
  if (
    !Array.isArray(r.aliases) ||
    !["ACTIVE", "MERGED", "ARCHIVED"].includes(String(r.status))
  )
    return invalid();
  return {
    id: id(r.id),
    workspaceId: id(r.workspaceId),
    type: text(r.type) as Entity["type"],
    status: r.status as Entity["status"],
    canonicalLabel: text(r.canonicalLabel, 200),
    aliases: r.aliases.map(parseAlias),
    mergedInto: r.mergedInto === null ? null : parseEntityRef(r.mergedInto),
    revision: revision(r.revision),
    createdAt: instant(r.createdAt),
    updatedAt: instant(r.updatedAt),
  };
}
function parseAlias(value: unknown) {
  const r = record(value);
  return { id: id(r.id), label: text(r.label, 200), createdAt: instant(r.createdAt) };
}
function parseIdentifier(value: unknown): IdentifierView {
  const r = record(value);
  const classified = parseClassifiedField(value);
  return {
    id: id(r.id),
    entityId: id(r.entityId),
    workspaceId: id(r.workspaceId),
    type: text(r.type),
    status: ["ACTIVE", "REVOKED"].includes(String(r.status))
      ? (r.status as IdentifierView["status"])
      : invalid(),
    revision: revision(r.revision),
    createdAt: instant(r.createdAt),
    updatedAt: instant(r.updatedAt),
    ...classified,
  } as IdentifierView;
}
function parseMatchSignal(value: unknown) {
  const r = record(value);
  if (!FIELD_VISIBILITIES.includes(r.valueVisibility as never)) return invalid();
  return {
    field: text(r.field),
    result: text(r.result),
    strength: text(r.strength),
    valueVisibility:
      r.valueVisibility as EntityMatchPage["items"][number]["signals"][number]["valueVisibility"],
  };
}
function parseCrossCaseContext(value: unknown) {
  const r = record(value);
  if (r.exists !== true || typeof r.detailsVisible !== "boolean") return invalid();
  return { exists: true as const, detailsVisible: r.detailsVisible };
}
