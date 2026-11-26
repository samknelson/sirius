import { alterHooks } from "@shared/alter";
export interface TrustRelationship {
  id: string;
  worker1: string;
  worker2: string;
  relationType: string;
  relationTypeName: string | null;
  relationSiriusId: string | null;
  startYmd: string | null;
  endYmd: string | null;
}
export type TrustRelationshipQuery =
  | { kind: "pair"; subscriberWorkerId: string; dependentWorkerId: string; asOfDate: Date }
  | { kind: "ids"; ids: readonly string[] }
  | { kind: "subscriber"; subscriberWorkerId: string };
export const trustRelationshipsHook = alterHooks.declare<
  readonly TrustRelationship[] | null, { readonly query: TrustRelationshipQuery }, Record<string, never>
>({
  id: "trust.relationships.resolve",
  description: "Resolve relationship authority and display facts for trust consumers",
  semantics: "Read-only, use the caller's transaction. Null means authority unavailable, never an empty authorized set. Preserve direction, dates and requested IDs. Errors refuse.",
});
export class TrustRelationshipsUnavailableError extends Error {
  constructor() { super("Worker relationship authority is unavailable"); }
}
export async function readTrustRelationships(query: TrustRelationshipQuery): Promise<readonly TrustRelationship[]> {
  if (query.kind === "ids" && query.ids.length === 0) return [];
  const rows = await alterHooks.run(trustRelationshipsHook, null, { query });
  if (rows === null) throw new TrustRelationshipsUnavailableError();
  return rows;
}
