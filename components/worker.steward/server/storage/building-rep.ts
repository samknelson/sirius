import { and, eq, ne } from "drizzle-orm";
import { workers, contacts } from "@shared/schema";
import { workerStewardAssignments } from "../../shared/schema/worker/steward/schema";
import { getClient } from "../../../../server/storage/transaction-context";
export async function getBuildingRepContactRow(employerId: string, bargainingUnitId: string, excludeWorkerId: string | null) {
  const rows = await getClient().select({ contact: contacts }).from(workerStewardAssignments)
    .innerJoin(workers, eq(workers.id, workerStewardAssignments.workerId))
    .innerJoin(contacts, eq(contacts.id, workers.contactId))
    .where(and(eq(workerStewardAssignments.employerId, employerId),
      eq(workerStewardAssignments.bargainingUnitId, bargainingUnitId),
      excludeWorkerId ? ne(workerStewardAssignments.workerId, excludeWorkerId) : undefined))
    .orderBy(contacts.displayName).limit(1);
  return rows[0]?.contact;
}
