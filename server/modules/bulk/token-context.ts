import type { IStorage } from "../../storage";
import { getClient } from "../../storage/transaction-context";
import {
  workers,
  employers,
  employerContacts,
  contacts,
  optionsGender,
  optionsWorkerWs,
  optionsWorkerMs,
  bargainingUnits,
  cardchecks,
  cardcheckDefinitions,
  workerStewardAssignments,
} from "../../../shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  const db = getClient();

  // Contact (with DOB + gender label resolution).
  const contactRows = await db
    .select({
      id: contacts.id,
      given: contacts.given,
      family: contacts.family,
      displayName: contacts.displayName,
      email: contacts.email,
      birthDate: contacts.birthDate,
      genderId: contacts.gender,
      genderNota: contacts.genderNota,
      genderName: optionsGender.name,
    })
    .from(contacts)
    .leftJoin(optionsGender, eq(optionsGender.id, contacts.gender))
    .where(eq(contacts.id, contactId))
    .limit(1);

  const contact = contactRows[0];
  if (contact) {
    data.contact = {
      id: contact.id,
      given: contact.given ?? null,
      family: contact.family ?? null,
      displayName: contact.displayName ?? null,
      email: contact.email ?? null,
      birthDate: contact.birthDate ?? null,
      genderName: contact.genderName ?? contact.genderNota ?? null,
    };
  }

  // Worker (with denormalized refs we need for the new tokens).
  const workerRows = await db
    .select({
      id: workers.id,
      jobTitle: workers.denormJobTitle,
      siriusId: workers.siriusId,
      homeEmployerId: workers.denormHomeEmployerId,
      employerIds: workers.denormEmployerIds,
      wsId: workers.denormWsId,
      msIds: workers.denormMsIds,
      bargainingUnitId: workers.bargainingUnitId,
    })
    .from(workers)
    .where(eq(workers.contactId, contactId))
    .limit(1);

  let employerId: string | null = null;
  let workerId: string | null = null;
  let bargainingUnitId: string | null = null;
  if (workerRows.length > 0) {
    const w = workerRows[0];
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
      const wsRows = await db
        .select({ name: optionsWorkerWs.name })
        .from(optionsWorkerWs)
        .where(eq(optionsWorkerWs.id, w.wsId))
        .limit(1);
      if (wsRows.length > 0) data.worker.workStatusName = wsRows[0].name;
    }

    // Member status names (array).
    if (w.msIds && w.msIds.length > 0) {
      const msRows = await db
        .select({ name: optionsWorkerMs.name, sequence: optionsWorkerMs.sequence })
        .from(optionsWorkerMs)
        .where(inArray(optionsWorkerMs.id, w.msIds))
        .orderBy(optionsWorkerMs.sequence);
      data.worker.memberStatusNames = msRows.map((r) => r.name);
    }

    // Bargaining unit name.
    if (bargainingUnitId) {
      const buRows = await db
        .select({ name: bargainingUnits.name })
        .from(bargainingUnits)
        .where(eq(bargainingUnits.id, bargainingUnitId))
        .limit(1);
      if (buRows.length > 0) data.worker.bargainingUnitName = buRows[0].name;
    }

    // Most recent cardcheck (latest signed_date; pending rows sort last).
    const ccRows = await db
      .select({
        type: cardcheckDefinitions.name,
        status: cardchecks.status,
        signedDate: cardchecks.signedDate,
      })
      .from(cardchecks)
      .innerJoin(
        cardcheckDefinitions,
        eq(cardcheckDefinitions.id, cardchecks.cardcheckDefinitionId),
      )
      .where(eq(cardchecks.workerId, w.id))
      .orderBy(sql`${cardchecks.signedDate} DESC NULLS LAST`)
      .limit(1);
    if (ccRows.length > 0) {
      data.worker.cardcheckType = ccRows[0].type ?? null;
      data.worker.cardcheckStatus = ccRows[0].status ?? null;
      data.worker.cardcheckSignedDate = ccRows[0].signedDate ?? null;
    }

    // Building rep: a steward assigned to this worker's BU + home employer
    // (other than the worker themselves).
    if (employerId && bargainingUnitId) {
      const repRows = await db
        .select({ displayName: contacts.displayName })
        .from(workerStewardAssignments)
        .innerJoin(workers, eq(workers.id, workerStewardAssignments.workerId))
        .innerJoin(contacts, eq(contacts.id, workers.contactId))
        .where(
          and(
            eq(workerStewardAssignments.employerId, employerId),
            eq(workerStewardAssignments.bargainingUnitId, bargainingUnitId),
            workerId
              ? sql`${workerStewardAssignments.workerId} <> ${workerId}`
              : sql`true`,
          ),
        )
        .orderBy(contacts.displayName)
        .limit(1);
      if (repRows.length > 0) data.worker.buildingRepName = repRows[0].displayName ?? null;
    }
  }

  if (employerId) {
    const emp = await db
      .select({ id: employers.id, name: employers.name })
      .from(employers)
      .where(eq(employers.id, employerId))
      .limit(1);
    if (emp.length > 0) data.employer = { id: emp[0].id, name: emp[0].name };
  }

  // Fall back to employer-contact links (e.g. employer-side recipients).
  if (!data.employer) {
    const ecRows = await db
      .select({ id: employers.id, name: employers.name })
      .from(employerContacts)
      .innerJoin(employers, eq(employers.id, employerContacts.employerId))
      .where(eq(employerContacts.contactId, contactId))
      .limit(1);
    if (ecRows.length > 0) data.employer = { id: ecRows[0].id, name: ecRows[0].name };
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
export async function detectAudienceScopes(contactIds: string[]): Promise<Set<"contact" | "worker" | "employer" | "system">> {
  const scopes = new Set<"contact" | "worker" | "employer" | "system">(["contact", "system"]);
  if (contactIds.length === 0) return scopes;
  const db = getClient();

  const workerRows = await db
    .select({
      id: workers.id,
      homeEmployerId: workers.denormHomeEmployerId,
      employerIds: workers.denormEmployerIds,
    })
    .from(workers)
    .where(inArray(workers.contactId, contactIds));
  if (workerRows.length > 0) {
    scopes.add("worker");
    if (workerRows.some((w) => w.homeEmployerId || (w.employerIds && w.employerIds.length > 0))) {
      scopes.add("employer");
    }
  }

  if (!scopes.has("employer")) {
    const ecRows = await db
      .select({ id: employerContacts.id })
      .from(employerContacts)
      .where(inArray(employerContacts.contactId, contactIds))
      .limit(1);
    if (ecRows.length > 0) scopes.add("employer");
  }

  return scopes;
}
