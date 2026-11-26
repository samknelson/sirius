import { and, eq, inArray } from "drizzle-orm";
import type { TrustRelationship, TrustRelationshipQuery } from "../../../../server/services/trust-relationships";
import { getClient } from "../../../../server/storage/transaction-context";
import { storage } from "../../../../server/storage/database";
import { workerRelations, optionsWorkerRelationType } from "../../shared/schema/worker/relations/schema";
export async function readRelationships(query: TrustRelationshipQuery): Promise<readonly TrustRelationship[]> {
  if (query.kind === "ids" && !query.ids.length) return [];
  let pairId: string | undefined;
  if (query.kind === "pair") {
    const row = await storage.workerRelations.findActiveBetween(query.subscriberWorkerId, query.dependentWorkerId, query.asOfDate);
    if (!row) return [];
    pairId = row.id;
  }
  return getClient().select({
    id: workerRelations.id, worker1: workerRelations.worker1, worker2: workerRelations.worker2,
    relationType: workerRelations.relationType, relationTypeName: optionsWorkerRelationType.name,
    relationSiriusId: optionsWorkerRelationType.siriusId,
    startYmd: workerRelations.startYmd, endYmd: workerRelations.endYmd,
  }).from(workerRelations).leftJoin(optionsWorkerRelationType, eq(workerRelations.relationType, optionsWorkerRelationType.id))
    .where(and(query.kind === "pair" ? eq(workerRelations.id, pairId!) :
      query.kind === "ids" ? inArray(workerRelations.id, [...query.ids]) :
      eq(workerRelations.worker1, query.subscriberWorkerId)));
}
