import type { IStorage } from "../../storage";
import {
  buildContextFromSources,
  type TokenContext,
  type TokenSourceData,
} from "../../../shared/bulk-tokens";

/**
 * Loads the per-recipient source data the registry's resolvers consume.
 * Adding a new token does NOT require touching this function — only the
 * shared registry — provided the data it needs is already on
 * TokenSourceData. Adding a new field to TokenSourceData is the only
 * structural change needed for genuinely new data sources.
 */
async function loadSourceData(storage: IStorage, contactId: string): Promise<TokenSourceData> {
  const data: TokenSourceData = { now: new Date() };

  // Contact (with DOB + gender label resolution).
  const contact = await storage.bulkTokens.getContactWithGender(contactId);
  if (contact) {
    data.contact = {
      id: contact.id,
      given: contact.given,
      family: contact.family,
      displayName: contact.displayName,
      email: contact.email,
      birthDate: contact.birthDate,
      genderName: contact.genderName,
    };
  }

  // Worker (with denormalized refs we need for the new tokens).
  const w = await storage.bulkTokens.getWorkerByContactId(contactId);

  let employerId: string | null = null;
  let workerId: string | null = null;
  let bargainingUnitId: string | null = null;
  if (w) {
    workerId = w.id;
    bargainingUnitId = w.bargainingUnitId ?? null;
    data.worker = {
      id: w.id,
      given: contact?.given ?? null,
      family: contact?.family ?? null,
      jobTitle: w.jobTitle ?? null,
      siriusId: w.siriusId ?? null,
    };
    employerId = w.homeEmployerId || (w.employerIds && w.employerIds[0]) || null;

    // Work status name.
    if (w.wsId) {
      const wsName = await storage.bulkTokens.getWorkStatusName(w.wsId);
      if (wsName) data.worker.workStatusName = wsName;
    }

    // Member status names (array).
    if (w.msIds && w.msIds.length > 0) {
      const names = await storage.bulkTokens.getMemberStatusNames(w.msIds);
      data.worker.memberStatusNames = names;
    }

    // Bargaining unit name.
    if (bargainingUnitId) {
      const buName = await storage.bulkTokens.getBargainingUnitName(bargainingUnitId);
      if (buName) data.worker.bargainingUnitName = buName;
    }

    // Most recent cardcheck (latest signed_date; pending rows sort last).
    const cc = await storage.bulkTokens.getLatestCardcheckForWorker(w.id);
    if (cc) {
      data.worker.cardcheckType = cc.type;
      data.worker.cardcheckStatus = cc.status;
      data.worker.cardcheckSignedDate = cc.signedDate;
    }

    // Building rep: a steward assigned to this worker's BU + home employer
    // (other than the worker themselves).
    if (employerId && bargainingUnitId) {
      const repName = await storage.bulkTokens.getBuildingRepName(
        employerId,
        bargainingUnitId,
        workerId,
      );
      if (repName) data.worker.buildingRepName = repName;
    }
  }

  if (employerId) {
    const emp = await storage.bulkTokens.getEmployerById(employerId);
    if (emp) data.employer = { id: emp.id, name: emp.name };
  }

  // Fall back to employer-contact links (e.g. employer-side recipients).
  if (!data.employer) {
    const emp = await storage.bulkTokens.getFirstEmployerLinkForContact(contactId);
    if (emp) data.employer = { id: emp.id, name: emp.name };
  }

  return data;
}

export async function buildRecipientContext(storage: IStorage, contactId: string): Promise<TokenContext> {
  const data = await loadSourceData(storage, contactId);
  return buildContextFromSources(data);
}

/**
 * Inspect each contactId and report which token scopes apply to the
 * audience. `contact` and `system` always apply. `worker` applies if
 * any contact is a worker; `employer` applies if any contact resolves
 * to an employer (via worker or employer-contact link).
 */
export async function detectAudienceScopes(
  storage: IStorage,
  contactIds: string[],
): Promise<Set<"contact" | "worker" | "employer" | "system">> {
  const scopes = new Set<"contact" | "worker" | "employer" | "system">(["contact", "system"]);
  if (contactIds.length === 0) return scopes;

  const workerRows = await storage.bulkTokens.countWorkerContacts(contactIds);
  if (workerRows.length > 0) {
    scopes.add("worker");
    if (workerRows.some((w) => w.homeEmployerId || (w.employerIds && w.employerIds.length > 0))) {
      scopes.add("employer");
    }
  }

  if (!scopes.has("employer")) {
    if (await storage.bulkTokens.hasAnyEmployerContact(contactIds)) {
      scopes.add("employer");
    }
  }

  return scopes;
}
