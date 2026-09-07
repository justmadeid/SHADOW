import { DATA_CLASSIFICATIONS, isResourceId } from "@intelligence/contracts";
import type { mutationPath } from "./proxy-path";

type MutationKind = NonNullable<ReturnType<typeof mutationPath>>;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~:+/-]{8,200}$/;

export function parseMutationInput(
  kind: MutationKind,
  raw: string,
  headers: Headers,
): { body?: string; idempotencyKey?: string; revision?: number } | null {
  if (new TextEncoder().encode(raw).byteLength > 8192) return null;
  if (kind === "TRANSITION_CASE") {
    if (raw.length) return null;
    const revision = parseRevision(headers.get("if-match"));
    return revision ? { revision } : null;
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
        : ["title", "objective"];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return null;
  if (kind === "CREATE_INVESTIGATION") {
    if (!validText(record.title, 3, 200) || !validText(record.objective, 3, 2000))
      return null;
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
    ["CREATE_CASE", "CREATE_INVESTIGATION"].includes(kind) &&
    !IDEMPOTENCY_KEY.test(idempotencyKey)
  )
    return null;
  if (kind === "UPDATE_CASE" && !revision) return null;
  return {
    body: JSON.stringify(record),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(revision ? { revision } : {}),
  };
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
