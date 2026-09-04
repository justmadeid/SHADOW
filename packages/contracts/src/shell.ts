import type { DataClassification } from "./classification.js";

export const PRODUCTS = ["SHADOW", "ECHO", "SPECTRA"] as const;
export type Product = (typeof PRODUCTS)[number];
export type ShellContext = { workspaceId?: string; caseId?: string };
export type UserSession = { user: { id: string } };
export type WorkspaceSummary = { id: string; name: string };
export type CaseSummary = {
  id: string;
  workspaceId: string;
  code: string;
  title: string;
  classification: DataClassification;
  status: "DRAFT" | "ACTIVE" | "CLOSED" | "ARCHIVED";
  revision: number;
};
export type CaseAccess = {
  workspaceId: string;
  caseId: string;
  permissions: {
    view: boolean;
    update: boolean;
    createInvestigation: boolean;
    manageMembers: boolean;
  };
};
export type CasePage = {
  items: CaseSummary[];
  page: { hasMore: boolean; nextCursor: string | null };
};

export function isResourceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Logical context only. Never preserve product-local filters, raw identifiers or credentials. */
export function productHref(product: Product, context: ShellContext = {}): string {
  if (!PRODUCTS.includes(product)) throw new Error("Invalid product");
  const query = new URLSearchParams();
  if (context.workspaceId) {
    if (!isResourceId(context.workspaceId)) throw new Error("Invalid Workspace");
    query.set("workspaceId", context.workspaceId);
  }
  if (context.caseId) {
    if (!context.workspaceId || !isResourceId(context.caseId))
      throw new Error("Invalid Case context");
    query.set("caseId", context.caseId);
  }
  return `/${product.toLowerCase()}${query.size ? `?${query}` : ""}`;
}

export function parseShellContext(query: URLSearchParams): ShellContext {
  if (["workspaceId", "caseId"].some((key) => query.getAll(key).length > 1))
    throw new Error("Duplicate context");
  const workspaceId = query.get("workspaceId");
  const caseId = query.get("caseId");
  if (
    (workspaceId !== null && !isResourceId(workspaceId)) ||
    (caseId !== null && (!workspaceId || !isResourceId(caseId)))
  )
    throw new Error("Invalid context");
  return { ...(workspaceId ? { workspaceId } : {}), ...(caseId ? { caseId } : {}) };
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 1024) return "/shadow";
  try {
    const url = new URL(value, "https://shell.invalid");
    const product = PRODUCTS.find((p) => url.pathname === `/${p.toLowerCase()}`);
    if (!value.startsWith("/") || url.origin !== "https://shell.invalid" || !product)
      return "/shadow";
    return productHref(product, parseShellContext(url.searchParams));
  } catch {
    return "/shadow";
  }
}
