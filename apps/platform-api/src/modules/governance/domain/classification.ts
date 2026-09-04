import {
  DATA_CLASSIFICATIONS,
  type DataClassification,
  type ClassificationHandling,
  type ClassifiedFieldView,
  type FieldVisibility,
  type MatchStatus,
} from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";

export function assertClassification(
  value: unknown,
): asserts value is DataClassification {
  if (
    typeof value !== "string" ||
    !(DATA_CLASSIFICATIONS as readonly string[]).includes(value)
  ) {
    throw new AppError({
      code: "GOVERNANCE_CLASSIFICATION_INVALID",
      message: "A valid data classification is required.",
      statusCode: 400,
    });
  }
}

/** Derived data cannot implicitly reduce the highest input sensitivity. */
export function deriveClassification(
  inputs: readonly DataClassification[],
  requested?: DataClassification,
): DataClassification {
  if (inputs.length === 0)
    throw new AppError({
      code: "GOVERNANCE_CLASSIFICATION_REQUIRED",
      message: "Derived data requires classified inputs.",
      statusCode: 400,
    });
  let highest: DataClassification = "PUBLIC";
  for (const input of inputs) {
    assertClassification(input);
    if (DATA_CLASSIFICATIONS.indexOf(input) > DATA_CLASSIFICATIONS.indexOf(highest))
      highest = input;
  }
  if (requested !== undefined) {
    assertClassification(requested);
    if (DATA_CLASSIFICATIONS.indexOf(requested) < DATA_CLASSIFICATIONS.indexOf(highest)) {
      throw new AppError({
        code: "GOVERNANCE_CLASSIFICATION_DOWNGRADE_DENIED",
        message: "Derived data cannot downgrade its input classification.",
        statusCode: 409,
      });
    }
    return requested;
  }
  return highest;
}

export function classificationHandling(
  classification: DataClassification,
): ClassificationHandling {
  assertClassification(classification);
  const sensitive = classification === "SENSITIVE" || classification === "RESTRICTED";
  return {
    classification,
    policyVersion: 1,
    identifierDefaultVisibility: sensitive ? "MASKED" : "FULL",
    applicationLogs: "METADATA_ONLY",
    metricsLabels: "NO_CONTENT",
    queuePayload: sensitive ? "REFERENCES_ONLY" : "REFERENCES_AND_METADATA",
    searchProjection: (
      {
        PUBLIC: "ALLOWED_FIELDS",
        INTERNAL: "SCOPED",
        SENSITIVE: "MINIMIZED_SCOPED",
        RESTRICTED: "NO_RAW_VALUES",
      } as const
    )[classification],
    rawPersistence:
      classification === "RESTRICTED"
        ? "DISABLED_BY_DEFAULT"
        : sensitive
          ? "MINIMIZED"
          : "SOURCE_POLICY",
    export: (
      {
        PUBLIC: "POLICY_REQUIRED",
        INTERNAL: "PERMISSION_REQUIRED",
        SENSITIVE: "EXPLICIT_POLICY_REQUIRED",
        RESTRICTED: "REDACTED_ONLY",
      } as const
    )[classification],
    workerRouting:
      classification === "RESTRICTED"
        ? "RESTRICTED"
        : sensitive
          ? "POLICY_DEPENDENT"
          : "GENERAL",
    retention:
      classification === "RESTRICTED"
        ? "EXPLICIT_MINIMIZED"
        : sensitive
          ? "EXPLICIT"
          : "SOURCE_POLICY",
    objectAccess:
      classification === "RESTRICTED"
        ? "SHORT_LIVED_STRICT_AUTH"
        : sensitive
          ? "SHORT_LIVED"
          : "SCOPED",
    crossCaseDisclosure:
      classification === "RESTRICTED"
        ? "DENY_BY_DEFAULT"
        : classification === "PUBLIC"
          ? "POLICY_REQUIRED"
          : "EXPLICIT_PERMISSION",
  };
}

/** Use only the server's current policy decision; never deserialize one from clients. */
export function presentClassifiedField(
  decision: { classification: DataClassification; visibility: FieldVisibility },
  field: { value?: string; matchStatus?: MatchStatus },
): ClassifiedFieldView {
  assertClassification(decision.classification);
  const classification = decision.classification;
  switch (decision.visibility) {
    case "FULL":
      if (typeof field.value !== "string")
        throw new AppError({
          code: "GOVERNANCE_FIELD_VALUE_REQUIRED",
          message: "A full field view requires a string value.",
          statusCode: 500,
        });
      return { classification, visibility: "FULL", displayValue: field.value };
    case "MASKED":
      // Fixed length and no prefix/suffix: safe even for short identifiers.
      return { classification, visibility: "MASKED", displayValue: "••••" };
    case "MATCH_ONLY":
      return {
        classification,
        visibility: "MATCH_ONLY",
        matchStatus:
          field.matchStatus === "EXACT_MATCH" || field.matchStatus === "NO_MATCH"
            ? field.matchStatus
            : "UNKNOWN",
      };
    default:
      return { classification, visibility: "HIDDEN" };
  }
}
