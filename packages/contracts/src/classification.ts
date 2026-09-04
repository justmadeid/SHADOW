export const DATA_CLASSIFICATIONS = [
  "PUBLIC",
  "INTERNAL",
  "SENSITIVE",
  "RESTRICTED",
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];
export const FIELD_VISIBILITIES = ["FULL", "MASKED", "MATCH_ONLY", "HIDDEN"] as const;
export type FieldVisibility = (typeof FIELD_VISIBILITIES)[number];
export type MatchStatus = "EXACT_MATCH" | "NO_MATCH" | "UNKNOWN";

/** Handling obligations, not an access grant or proof of enforcement. */
export type ClassificationHandling = {
  classification: DataClassification;
  policyVersion: 1;
  identifierDefaultVisibility: "FULL" | "MASKED";
  applicationLogs: "METADATA_ONLY";
  metricsLabels: "NO_CONTENT";
  queuePayload: "REFERENCES_ONLY" | "REFERENCES_AND_METADATA";
  searchProjection: "ALLOWED_FIELDS" | "SCOPED" | "MINIMIZED_SCOPED" | "NO_RAW_VALUES";
  rawPersistence: "SOURCE_POLICY" | "MINIMIZED" | "DISABLED_BY_DEFAULT";
  export:
    | "POLICY_REQUIRED"
    | "PERMISSION_REQUIRED"
    | "EXPLICIT_POLICY_REQUIRED"
    | "REDACTED_ONLY";
  workerRouting: "GENERAL" | "POLICY_DEPENDENT" | "RESTRICTED";
  retention: "SOURCE_POLICY" | "EXPLICIT" | "EXPLICIT_MINIMIZED";
  objectAccess: "SCOPED" | "SHORT_LIVED" | "SHORT_LIVED_STRICT_AUTH";
  crossCaseDisclosure: "POLICY_REQUIRED" | "EXPLICIT_PERMISSION" | "DENY_BY_DEFAULT";
};

export type ClassifiedFieldView = { classification: DataClassification } & (
  | { visibility: "FULL" | "MASKED"; displayValue: string }
  | { visibility: "MATCH_ONLY"; matchStatus: MatchStatus }
  | { visibility: "HIDDEN" }
);
