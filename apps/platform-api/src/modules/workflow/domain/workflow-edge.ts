import { AppError } from "../../../platform/errors/index.js";

export type WorkflowEdge = Readonly<{
  id: string;
  investigationId: string;
  fromNodeInstanceId: string;
  toNodeInstanceId: string;
  createdAt: Date;
}>;

export type EdgeRef = { fromNodeInstanceId: string; toNodeInstanceId: string };

export function assertValidEdgeCandidate(
  fromNodeInstanceId: string,
  toNodeInstanceId: string,
  existingEdges: readonly EdgeRef[],
): void {
  if (fromNodeInstanceId === toNodeInstanceId)
    throw new AppError({
      code: "WORKFLOW_EDGE_SELF_LOOP",
      message: "A WorkflowEdge cannot connect a NodeInstance to itself.",
      statusCode: 400,
    });

  const isDuplicate = existingEdges.some(
    (edge) =>
      edge.fromNodeInstanceId === fromNodeInstanceId &&
      edge.toNodeInstanceId === toNodeInstanceId,
  );
  if (isDuplicate)
    throw new AppError({
      code: "WORKFLOW_EDGE_DUPLICATE",
      message: "This WorkflowEdge already exists.",
      statusCode: 409,
    });

  if (createsCycle(fromNodeInstanceId, toNodeInstanceId, existingEdges))
    throw new AppError({
      code: "WORKFLOW_EDGE_CYCLE",
      message: "This WorkflowEdge would create a cycle.",
      statusCode: 409,
    });
}

/**
 * True iff adding an edge from -> to would create a cycle in the graph formed
 * by `existingEdges`: equivalent to asking whether `from` is reachable from
 * `to` via the existing edges (a simple BFS/DFS over the adjacency list).
 */
export function createsCycle(
  from: string,
  to: string,
  existingEdges: readonly EdgeRef[],
): boolean {
  if (from === to) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const list = adjacency.get(edge.fromNodeInstanceId) ?? [];
    list.push(edge.toNodeInstanceId);
    adjacency.set(edge.fromNodeInstanceId, list);
  }
  const visited = new Set<string>();
  const queue = [to];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === from) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of adjacency.get(node) ?? []) queue.push(next);
  }
  return false;
}
