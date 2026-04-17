import type { IStorage } from "../../storage";
import { getClient } from "../../storage/transaction-context";
import { workers, employers, employerContacts } from "../../../shared/schema";
import { eq, inArray } from "drizzle-orm";
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

  const contact = await storage.contacts.getContact(contactId);
  if (contact) {
    data.contact = {
      id: contact.id,
      given: contact.given ?? null,
      family: contact.family ?? null,
      displayName: contact.displayName ?? null,
      email: contact.email ?? null,
    };
  }

  const db = getClient();
  const workerRows = await db
    .select({
      id: workers.id,
      jobTitle: workers.denormJobTitle,
      siriusId: workers.siriusId,
      homeEmployerId: workers.denormHomeEmployerId,
      employerIds: workers.denormEmployerIds,
    })
    .from(workers)
    .where(eq(workers.contactId, contactId))
    .limit(1);

  let employerId: string | null = null;
  if (workerRows.length > 0) {
    const w = workerRows[0];
    data.worker = {
      id: w.id,
      given: contact?.given ?? null,
      family: contact?.family ?? null,
      jobTitle: w.jobTitle ?? null,
      siriusId: w.siriusId ?? null,
    };
    employerId = w.homeEmployerId || (w.employerIds && w.employerIds[0]) || null;
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
