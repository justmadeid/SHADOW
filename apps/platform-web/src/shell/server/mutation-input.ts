import {
  DATA_CLASSIFICATIONS,
  SUBJECT_ROLES,
  SUBJECT_SEED_FIELD_NAMES,
  SUBJECT_TYPES,
  isResourceId,
} from "@intelligence/contracts";
import type { MutationKind } from "./proxy-path";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~:+/-]{8,200}$/;

export function parseMutationInput(
  kind: MutationKind,
  raw: string,
  headers: Headers,
): {
  body?: string;
  idempotencyKey?: string;
  revision?: number;
  auditOperationId?: string;
} | null {
  if (new TextEncoder().encode(raw).byteLength > 8192) return null;
  if (kind === "TRANSITION_CASE" || kind === "START_RESOLUTION") {
    if (raw.length) return null;
    const revision = parseRevision(headers.get("if-match"));
    if (!revision) return null;
    if (kind === "START_RESOLUTION") {
      const idempotencyKey = headers.get("idempotency-key") ?? "";
      return IDEMPOTENCY_KEY.test(idempotencyKey) ? { revision, idempotencyKey } : null;
    }
    return { revision };
  }
  if (
    headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed =
    kind === "CREATE_CASE"
      ? ["workspaceId", "title", "description", "classification"]
      : kind === "UPDATE_CASE"
        ? ["title", "description", "classification"]
        : kind === "CREATE_INVESTIGATION"
          ? ["title", "objective"]
          : kind === "CREATE_SUBJECT"
            ? ["subjectType", "role", "investigationId", "seed"]
            : ["decision", "entityId", "reasonCode"];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return null;
  if (kind === "CREATE_INVESTIGATION") {
    if (!validText(record.title, 3, 200) || !validText(record.objective, 3, 2000))
      return null;
  } else if (kind === "CREATE_SUBJECT") {
    if (!validSubject(record)) return null;
  } else if (kind === "RESOLVE_CANDIDATE") {
    if (!validCandidateDecision(record)) return null;
  } else if (
    !validText(record.title, 3, 200) ||
    !(record.description === null || validOptionalText(record.description, 4000)) ||
    !DATA_CLASSIFICATIONS.includes(record.classification as never) ||
    (kind === "CREATE_CASE" && !isResourceId(String(record.workspaceId ?? "")))
  ) {
    return null;
  }
  const idempotencyKey = headers.get("idempotency-key") ?? "";
  const revision = parseRevision(headers.get("if-match"));
  if (
    [
      "CREATE_CASE",
      "CREATE_INVESTIGATION",
      "CREATE_SUBJECT",
      "RESOLVE_CANDIDATE",
    ].includes(kind) &&
    !IDEMPOTENCY_KEY.test(idempotencyKey)
  )
    return null;
  if (["UPDATE_CASE", "RESOLVE_CANDIDATE"].includes(kind) && !revision) return null;
  if (
    kind === "RESOLVE_CANDIDATE" &&
    !isResourceId(headers.get("x-audit-operation-id") ?? "")
  )
    return null;
  return {
    body: JSON.stringify(record),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(revision ? { revision } : {}),
    ...(kind === "RESOLVE_CANDIDATE"
      ? { auditOperationId: headers.get("x-audit-operation-id")! }
      : {}),
  };
}

function validSubject(record: Record<string, unknown>): boolean {
  if (
    !SUBJECT_TYPES.includes(record.subjectType as never) ||
    !SUBJECT_ROLES.includes(record.role as never) ||
    !(
      record.investigationId === undefined ||
      record.investigationId === null ||
      (typeof record.investigationId === "string" && isResourceId(record.investigationId))
    )
  )
    return false;
  if (!record.seed || typeof record.seed !== "object" || Array.isArray(record.seed))
    return false;
  const seed = record.seed as Record<string, unknown>;
  if (Object.keys(seed).some((key) => key !== "fields")) return false;
  if (!Array.isArray(seed.fields) || seed.fields.length < 1 || seed.fields.length > 20)
    return false;
  const seen = new Set<string>();
  return seed.fields.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const field = value as Record<string, unknown>;
    if (
      Object.keys(field).some(
        (key) => !["name", "value", "origin", "classification"].includes(key),
      ) ||
      !SUBJECT_SEED_FIELD_NAMES.includes(field.name as never) ||
      seen.has(String(field.name)) ||
      field.origin !== "INVESTIGATOR_INPUT" ||
      !["PUBLIC", "INTERNAL", "SENSITIVE"].includes(String(field.classification)) ||
      !validText(field.value, 1, field.name === "SOCIAL_PROFILE_URL" ? 2000 : 300)
    )
      return false;
    seen.add(String(field.name));
    return true;
  });
}

function validCandidateDecision(record: Record<string, unknown>): boolean {
  const requiresExisting = record.decision === "LINK_EXISTING";
  return (
    ["LINK_EXISTING", "CREATE_NEW", "UNCERTAIN", "REJECT"].includes(
      String(record.decision),
    ) &&
    [
      "EXACT_IDENTIFIER_MATCH",
      "MULTIPLE_SUPPORTING_SIGNALS",
      "INSUFFICIENT_EVIDENCE",
      "CONFLICTING_SIGNALS",
      "NOT_SAME_IDENTITY",
      "MANUAL_REVIEW",
    ].includes(String(record.reasonCode)) &&
    (requiresExisting
      ? typeof record.entityId === "string" && isResourceId(record.entityId)
      : record.entityId === undefined)
  );
}

/** Bound actual streamed bytes, including requests without Content-Length. */
export async function readMutationBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      size += chunk.value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function validText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}
function validOptionalText(value: unknown, max: number): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= max);
}
function parseRevision(value: string | null): number | null {
  const match = value?.match(/^"([1-9][0-9]*)"$/);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}
