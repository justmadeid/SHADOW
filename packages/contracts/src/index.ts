export type ResourceType =
  | "WORKSPACE"
  | "CASE"
  | "INVESTIGATION"
  | "SUBJECT"
  | "CANDIDATE"
  | "ENTITY"
  | "CLAIM"
  | "RELATIONSHIP"
  | "EVIDENCE"
  | "DATASET"
  | "ANALYSIS"
  | "RUN"
  | "ALERT"
  | "HYPOTHESIS"
  | "FINDING"
  | "NOTIFICATION";

export type ResourceRef = {
  type: ResourceType;
  id: string;
  workspaceId: string;
  caseId?: string;
};

export type DataClassification = "PUBLIC" | "INTERNAL" | "SENSITIVE" | "RESTRICTED";
export type FieldVisibility = "FULL" | "MASKED" | "MATCH_ONLY" | "HIDDEN";
