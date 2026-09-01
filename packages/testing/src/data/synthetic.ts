import { randomUUID } from "node:crypto";

export type SyntheticCase = {
  id: string;
  workspaceId: string;
  title: string;
  classification: "PUBLIC" | "INTERNAL" | "SENSITIVE" | "RESTRICTED";
};

export function syntheticWorkspaceId(): string {
  return randomUUID();
}

export function syntheticCase(overrides: Partial<SyntheticCase> = {}): SyntheticCase {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    title: "Synthetic Investigation Case",
    classification: "SENSITIVE",
    ...overrides,
  };
}

/**
 * Never place real NIK, phone numbers, emails, or production identifiers in
 * shared test fixtures. Restricted-flow tests should use obviously synthetic,
 * non-real values and test only behavior/masking.
 */
export const SYNTHETIC_RESTRICTED_IDENTIFIER = "TEST-NATIONAL-ID-000001";
