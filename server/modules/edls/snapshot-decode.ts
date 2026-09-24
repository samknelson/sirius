import type { SnapshotNode } from "@shared/snapshots";

/**
 * Decode a stored `edls_sheet` snapshot bundle into the same shapes the live
 * GET endpoints return, so the client can feed the decoded data straight
 * into the sheet-details rendering component:
 *
 * - `sheet` — the shape of `GET /api/edls/sheets/:id` (sheet with relations)
 * - `crews` — the shape of `GET /api/edls/sheets/:id/crews` (crews with relations)
 * - `assignments` — the shape of `GET /api/edls/sheets/:id/assignments`
 *
 * Dispatches on the per-node `version`; stored snapshots are never migrated.
 * Nested nodes carry their own versions, so a newer sheet bundle may
 * legitimately contain older crew/assignment bundles.
 */
export interface DecodedEdlsSheetSnapshot {
  sheet: Record<string, unknown>;
  crews: Record<string, unknown>[];
  assignments: Record<string, unknown>[];
}

export function decodeEdlsSheetSnapshot(node: SnapshotNode): DecodedEdlsSheetSnapshot {
  switch (node.version) {
    case 1:
      return decodeV1(node.data);
    default:
      throw new Error(`Unsupported edls_sheet snapshot version: ${node.version}`);
  }
}

function decodeCrewNode(crewNode: SnapshotNode): { crew: Record<string, unknown>; assignments: Record<string, unknown>[] } {
  switch (crewNode.version) {
    case 1: {
      const { assignments: assignmentNodes, ...crew } = crewNode.data as Record<string, unknown> & {
        assignments?: SnapshotNode[];
      };
      const assignments = (assignmentNodes ?? []).map(decodeAssignmentNode);
      return { crew, assignments };
    }
    default:
      throw new Error(`Unsupported edls_crew snapshot version: ${crewNode.version}`);
  }
}

function decodeAssignmentNode(assignmentNode: SnapshotNode): Record<string, unknown> {
  switch (assignmentNode.version) {
    case 1:
      return assignmentNode.data as Record<string, unknown>;
    default:
      throw new Error(`Unsupported edls_assignment snapshot version: ${assignmentNode.version}`);
  }
}

function decodeV1(data: unknown): DecodedEdlsSheetSnapshot {
  const { crews: crewNodes, ...sheet } = data as Record<string, unknown> & { crews?: SnapshotNode[] };
  const crews: Record<string, unknown>[] = [];
  const assignments: Record<string, unknown>[] = [];
  for (const crewNode of crewNodes ?? []) {
    const decoded = decodeCrewNode(crewNode);
    crews.push(decoded.crew);
    assignments.push(...decoded.assignments);
  }
  return { sheet, crews, assignments };
}
