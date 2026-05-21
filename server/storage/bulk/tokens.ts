import { getClient } from "../transaction-context";
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
} from "@shared/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

export interface BulkTokenContactRow {
  id: string;
  given: string | null;
  family: string | null;
  displayName: string | null;
  email: string | null;
  birthDate: string | null;
  genderName: string | null;
}

export interface BulkTokenWorkerRow {
  contactId: string;
  id: string;
  jobTitle: string | null;
  siriusId: number | null;
  homeEmployerId: string | null;
  employerIds: string[] | null;
  wsId: string | null;
  msIds: string[] | null;
  bargainingUnitId: string | null;
}

export interface BulkTokenCardcheckRow {
  type: string | null;
  status: string | null;
  signedDate: string | null;
}

export interface BulkTokenEmployerRow {
  id: string;
  name: string;
}

export interface BulkTokensStorage {
  getContactWithGender(contactId: string): Promise<BulkTokenContactRow | undefined>;
  getContactsBasicByIds(contactIds: string[]): Promise<Array<{
    id: string;
    given: string | null;
    family: string | null;
    displayName: string | null;
    email: string | null;
  }>>;
  getWorkerByContactId(contactId: string): Promise<BulkTokenWorkerRow | undefined>;
  getWorkersByContactIds(contactIds: string[]): Promise<BulkTokenWorkerRow[]>;
  getWorkStatusName(wsId: string): Promise<string | null>;
  getMemberStatusNames(msIds: string[]): Promise<string[]>;
  getBargainingUnitName(buId: string): Promise<string | null>;
  getLatestCardcheckForWorker(workerId: string): Promise<BulkTokenCardcheckRow | undefined>;
  getBuildingRepName(employerId: string, bargainingUnitId: string, excludeWorkerId: string | null): Promise<string | null>;
  getEmployerById(employerId: string): Promise<BulkTokenEmployerRow | undefined>;
  getEmployersByIds(employerIds: string[]): Promise<BulkTokenEmployerRow[]>;
  getFirstEmployerLinkForContact(contactId: string): Promise<BulkTokenEmployerRow | undefined>;
  getFirstEmployerLinksByContactIds(contactIds: string[]): Promise<Array<{ contactId: string; employerId: string }>>;
  countWorkerContacts(contactIds: string[]): Promise<Array<{ homeEmployerId: string | null; employerIds: string[] | null }>>;
  hasAnyEmployerContact(contactIds: string[]): Promise<boolean>;
}

export function createBulkTokensStorage(): BulkTokensStorage {
  return {
    async getContactWithGender(contactId) {
      const client = getClient();
      const rows = await client
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
      const row = rows[0];
      if (!row) return undefined;
      return {
        id: row.id,
        given: row.given ?? null,
        family: row.family ?? null,
        displayName: row.displayName ?? null,
        email: row.email ?? null,
        birthDate: row.birthDate ?? null,
        genderName: row.genderName ?? row.genderNota ?? null,
      };
    },

    async getContactsBasicByIds(contactIds) {
      if (contactIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({
          id: contacts.id,
          given: contacts.given,
          family: contacts.family,
          displayName: contacts.displayName,
          email: contacts.email,
        })
        .from(contacts)
        .where(inArray(contacts.id, contactIds));
    },

    async getWorkerByContactId(contactId) {
      const client = getClient();
      const rows = await client
        .select({
          contactId: workers.contactId,
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
      return rows[0] || undefined;
    },

    async getWorkersByContactIds(contactIds) {
      if (contactIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({
          contactId: workers.contactId,
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
        .where(inArray(workers.contactId, contactIds));
    },

    async getWorkStatusName(wsId) {
      const client = getClient();
      const rows = await client
        .select({ name: optionsWorkerWs.name })
        .from(optionsWorkerWs)
        .where(eq(optionsWorkerWs.id, wsId))
        .limit(1);
      return rows[0]?.name ?? null;
    },

    async getMemberStatusNames(msIds) {
      if (msIds.length === 0) return [];
      const client = getClient();
      const rows = await client
        .select({ name: optionsWorkerMs.name, sequence: optionsWorkerMs.sequence })
        .from(optionsWorkerMs)
        .where(inArray(optionsWorkerMs.id, msIds))
        .orderBy(optionsWorkerMs.sequence);
      return rows.map((r) => r.name);
    },

    async getBargainingUnitName(buId) {
      const client = getClient();
      const rows = await client
        .select({ name: bargainingUnits.name })
        .from(bargainingUnits)
        .where(eq(bargainingUnits.id, buId))
        .limit(1);
      return rows[0]?.name ?? null;
    },

    async getLatestCardcheckForWorker(workerId) {
      const client = getClient();
      const rows = await client
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
        .where(eq(cardchecks.workerId, workerId))
        .orderBy(sql`${cardchecks.signedDate} DESC NULLS LAST`)
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      return {
        type: row.type ?? null,
        status: row.status ?? null,
        signedDate: row.signedDate ?? null,
      };
    },

    async getBuildingRepName(employerId, bargainingUnitId, excludeWorkerId) {
      const client = getClient();
      const conditions = [
        eq(workerStewardAssignments.employerId, employerId),
        eq(workerStewardAssignments.bargainingUnitId, bargainingUnitId),
      ];
      if (excludeWorkerId) {
        conditions.push(ne(workerStewardAssignments.workerId, excludeWorkerId));
      }
      const rows = await client
        .select({ displayName: contacts.displayName })
        .from(workerStewardAssignments)
        .innerJoin(workers, eq(workers.id, workerStewardAssignments.workerId))
        .innerJoin(contacts, eq(contacts.id, workers.contactId))
        .where(and(...conditions))
        .orderBy(contacts.displayName)
        .limit(1);
      return rows[0]?.displayName ?? null;
    },

    async getEmployerById(employerId) {
      const client = getClient();
      const rows = await client
        .select({ id: employers.id, name: employers.name })
        .from(employers)
        .where(eq(employers.id, employerId))
        .limit(1);
      return rows[0] || undefined;
    },

    async getEmployersByIds(employerIds) {
      if (employerIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({ id: employers.id, name: employers.name })
        .from(employers)
        .where(inArray(employers.id, employerIds));
    },

    async getFirstEmployerLinkForContact(contactId) {
      const client = getClient();
      const rows = await client
        .select({ id: employers.id, name: employers.name })
        .from(employerContacts)
        .innerJoin(employers, eq(employers.id, employerContacts.employerId))
        .where(eq(employerContacts.contactId, contactId))
        .limit(1);
      return rows[0] || undefined;
    },

    async getFirstEmployerLinksByContactIds(contactIds) {
      if (contactIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({
          contactId: employerContacts.contactId,
          employerId: employerContacts.employerId,
        })
        .from(employerContacts)
        .where(inArray(employerContacts.contactId, contactIds));
    },

    async countWorkerContacts(contactIds) {
      if (contactIds.length === 0) return [];
      const client = getClient();
      return await client
        .select({
          homeEmployerId: workers.denormHomeEmployerId,
          employerIds: workers.denormEmployerIds,
        })
        .from(workers)
        .where(inArray(workers.contactId, contactIds));
    },

    async hasAnyEmployerContact(contactIds) {
      if (contactIds.length === 0) return false;
      const client = getClient();
      const rows = await client
        .select({ id: employerContacts.id })
        .from(employerContacts)
        .where(inArray(employerContacts.contactId, contactIds))
        .limit(1);
      return rows.length > 0;
    },
  };
}
