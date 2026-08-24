import { getClient } from "../transaction-context";
import {
  workers,
  employers,
  employerContacts,
  contacts,
  optionsWorkerWs,
  optionsWorkerMs,
  bargainingUnits,
  cardchecks,
  cardcheckDefinitions,
  workerStewardAssignments,
} from "@shared/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

type Row = Record<string, unknown>;

export interface BulkTokenCardcheckRow {
  /**
   * The worker the card check belongs to. A card check has no page of
   * its own — the worker's cardchecks tab is where it is shown — so the
   * row has to carry the id that page is reached by, or a message about
   * a card check can link nowhere.
   */
  workerId: string;
  type: string | null;
  status: string | null;
  signedDate: Date | null;
}

/**
 * Token-entity storage. Entity getters return FULL rows (select *) so
 * the generic field(name=…) token can read any column, including ones
 * added in the future, without storage changes.
 */
export interface BulkTokensStorage {
  getContactRow(contactId: string): Promise<Row | undefined>;
  getContactsBasicByIds(contactIds: string[]): Promise<Array<{
    id: string;
    given: string | null;
    family: string | null;
    displayName: string | null;
    email: string | null;
  }>>;
  /** Full workers row plus employment/status denorm extras. */
  getWorkerRowByContactId(contactId: string): Promise<Row | undefined>;
  /** Same shape as getWorkerRowByContactId, keyed by worker id. */
  getWorkerRowById(workerId: string): Promise<Row | undefined>;
  getEmployerRow(employerId: string): Promise<Row | undefined>;
  getFirstEmployerLinkRowForContact(contactId: string): Promise<Row | undefined>;
  getBargainingUnitRow(buId: string): Promise<Row | undefined>;
  getWorkStatusRow(wsId: string): Promise<Row | undefined>;
  getMemberStatusNames(msIds: string[]): Promise<string[]>;
  getLatestCardcheckForWorker(workerId: string): Promise<BulkTokenCardcheckRow | undefined>;
  /** Full contacts row of the steward assigned to (employer, BU). */
  getBuildingRepContactRow(
    employerId: string,
    bargainingUnitId: string,
    excludeWorkerId: string | null,
  ): Promise<Row | undefined>;
  /**
   * Display name of a referenced row, used by the field token to
   * render FK values (options tables etc.) as their `name` column.
   * Table/column names come from the Drizzle schema config, never
   * from user input.
   */
  getNameByReference(
    tableName: string,
    keyColumn: string,
    id: string,
  ): Promise<string | null>;
  /**
   * FULL referenced row, used by the generated entity relations to walk
   * a foreign key to the record it points at. Same contract as the
   * entity getters above — every column, so `field(name=…)` can read
   * any of them — and the same trust boundary as
   * {@link getNameByReference}: table and column names come from the
   * Drizzle schema config, never from user input.
   *
   * Only used for kinds whose whole field catalog IS their table. A
   * kind that advertises derived fields loads itself through its own
   * loader instead, so a relation never lands on a row that is missing
   * fields the catalog promises.
   */
  getRowByReference(
    tableName: string,
    keyColumn: string,
    id: string,
  ): Promise<Row | null>;
}

// NOTE: the correlation must be spelled as a literal qualified
// identifier — interpolating ${workers.id} inside a selection sql``
// fragment renders the bare `"id"`, which silently mis-correlates to
// the subquery's own table and returns NULL.
const workerExtras = {
  jobTitle: sql<string | null>`(SELECT wed.job_title FROM worker_employment_denorm wed WHERE wed.worker_id = "workers"."id" AND wed.home = true LIMIT 1)`,
  homeEmployerId: sql<string | null>`(SELECT wed.employer_id FROM worker_employment_denorm wed WHERE wed.worker_id = "workers"."id" AND wed.home = true LIMIT 1)`,
  employerIds: sql<string[] | null>`(SELECT array_agg(wed.employer_id) FROM worker_employment_denorm wed WHERE wed.worker_id = "workers"."id")`,
  wsId: sql<string | null>`(SELECT wwd.ws_id FROM worker_wsh_denorm wwd WHERE wwd.worker_id = "workers"."id")`,
  msIds: sql<string[] | null>`(SELECT array_agg(wmd.ms_id) FROM worker_msh_denorm wmd WHERE wmd.worker_id = "workers"."id")`,
};

/** Field names of the denorm extras merged onto the workers row. */
export const WORKER_EXTRA_FIELDS = [
  "job_title",
  "home_employer_id",
  "employer_ids",
  "ws_id",
  "ms_ids",
];

export function createBulkTokensStorage(): BulkTokensStorage {
  return {
    async getContactRow(contactId) {
      const client = getClient();
      const rows = await client
        .select()
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);
      return rows[0] || undefined;
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

    async getWorkerRowByContactId(contactId) {
      const client = getClient();
      const rows = await client
        .select()
        .from(workers)
        .where(eq(workers.contactId, contactId))
        .limit(1);
      const worker = rows[0];
      if (!worker) return undefined;
      const extraRows = await client
        .select(workerExtras)
        .from(workers)
        .where(eq(workers.id, worker.id))
        .limit(1);
      return { ...worker, ...(extraRows[0] || {}) };
    },

    async getWorkerRowById(workerId) {
      const client = getClient();
      const rows = await client
        .select()
        .from(workers)
        .where(eq(workers.id, workerId))
        .limit(1);
      const worker = rows[0];
      if (!worker) return undefined;
      const extraRows = await client
        .select(workerExtras)
        .from(workers)
        .where(eq(workers.id, worker.id))
        .limit(1);
      return { ...worker, ...(extraRows[0] || {}) };
    },

    async getEmployerRow(employerId) {
      const client = getClient();
      const rows = await client
        .select()
        .from(employers)
        .where(eq(employers.id, employerId))
        .limit(1);
      return rows[0] || undefined;
    },

    async getFirstEmployerLinkRowForContact(contactId) {
      const client = getClient();
      const rows = await client
        .select({ employer: employers })
        .from(employerContacts)
        .innerJoin(employers, eq(employers.id, employerContacts.employerId))
        .where(eq(employerContacts.contactId, contactId))
        .limit(1);
      return rows[0]?.employer || undefined;
    },

    async getBargainingUnitRow(buId) {
      const client = getClient();
      const rows = await client
        .select()
        .from(bargainingUnits)
        .where(eq(bargainingUnits.id, buId))
        .limit(1);
      return rows[0] || undefined;
    },

    async getWorkStatusRow(wsId) {
      const client = getClient();
      const rows = await client
        .select()
        .from(optionsWorkerWs)
        .where(eq(optionsWorkerWs.id, wsId))
        .limit(1);
      return rows[0] || undefined;
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

    async getLatestCardcheckForWorker(workerId) {
      const client = getClient();
      const rows = await client
        .select({
          workerId: cardchecks.workerId,
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
        workerId: row.workerId,
        type: row.type ?? null,
        status: row.status ?? null,
        signedDate: row.signedDate ?? null,
      };
    },

    async getBuildingRepContactRow(employerId, bargainingUnitId, excludeWorkerId) {
      const client = getClient();
      const conditions = [
        eq(workerStewardAssignments.employerId, employerId),
        eq(workerStewardAssignments.bargainingUnitId, bargainingUnitId),
      ];
      if (excludeWorkerId) {
        conditions.push(ne(workerStewardAssignments.workerId, excludeWorkerId));
      }
      const rows = await client
        .select({ contact: contacts })
        .from(workerStewardAssignments)
        .innerJoin(workers, eq(workers.id, workerStewardAssignments.workerId))
        .innerJoin(contacts, eq(contacts.id, workers.contactId))
        .where(and(...conditions))
        .orderBy(contacts.displayName)
        .limit(1);
      return rows[0]?.contact || undefined;
    },

    async getNameByReference(tableName, keyColumn, id) {
      const client = getClient();
      const result = await client.execute(
        sql`SELECT name FROM ${sql.identifier(tableName)} WHERE ${sql.identifier(keyColumn)} = ${id} LIMIT 1`,
      );
      const row = (result.rows?.[0] ?? undefined) as { name?: unknown } | undefined;
      return row?.name == null ? null : String(row.name);
    },

    async getRowByReference(tableName, keyColumn, id) {
      const client = getClient();
      const result = await client.execute(
        sql`SELECT * FROM ${sql.identifier(tableName)} WHERE ${sql.identifier(keyColumn)} = ${id} LIMIT 1`,
      );
      const row = (result.rows?.[0] ?? undefined) as Row | undefined;
      return row ?? null;
    },
  };
}
