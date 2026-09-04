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

export { DATA_CLASSIFICATIONS, FIELD_VISIBILITIES } from "./classification.js";
export type {
  DataClassification,
  FieldVisibility,
  ClassificationHandling,
  ClassifiedFieldView,
  MatchStatus,
} from "./classification.js";
