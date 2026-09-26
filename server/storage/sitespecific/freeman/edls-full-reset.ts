import { sql, type AnyColumn } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import {
  contactPostal,
  contacts,
  comm,
  edlsAssignments,
  edlsCrews,
  edlsSheets,
  grievanceWorkers,
  phoneNumbers,
  workerEdls,
  workers,
} from "@shared/schema";
import { eventBus, EventType } from "../../../services/event-bus";
import { getClient, runInTransaction } from "../../transaction-context";

export interface FreemanEdlsFullResetCounts {
  workers: number;
  sheets: number;
  crews: number;
  assignments: number;
}

export interface FreemanEdlsFullResetRelation {
  entity: "worker" | "contact";
  workerId?: string;
  contactId?: string;
  relationshipType: "foreign_key";
  referencingSchema: string;
  referencingTable: string;
  referencingColumn: string;
  recordId: string;
  label: string | null;
  constraint: string;
  workerName: string | null;
  contactName: string | null;
  disposition: "intact" | "anonymized" | "blocker";
}

export interface FreemanEdlsFullResetPlan {
  counts: FreemanEdlsFullResetCounts;
  blockers: FreemanEdlsFullResetRelation[];
  preservations: FreemanEdlsFullResetRelation[];
}

export interface FreemanEdlsFullResetResult extends FreemanEdlsFullResetCounts {
  workerEdls: number;
  grievanceAssociations: number;
  contactsDeleted: number;
  contactsAnonymized: number;
  contactsPreserved: number;
  remaining: FreemanEdlsFullResetCounts & {
    workerEdls: number;
    grievanceAssociations: number;
  };
  failures: FreemanEdlsFullResetFailure[];
  stalePreflight: boolean;
}

export interface FreemanEdlsFullResetFailure {
  stage: FreemanEdlsFullResetStage;
  table: string;
  id?: string;
  worker?: { id: string; contactId: string };
  diagnostics: Record<string, string | undefined>;
  reason: "missing_table" | "record_failed" | "stage_failed";
}

export interface FreemanEdlsFullResetStorage {
  getCounts(): Promise<FreemanEdlsFullResetCounts>;
  getPlan(): Promise<FreemanEdlsFullResetPlan>;
  execute(expected: FreemanEdlsFullResetPlan | FreemanEdlsFullResetCounts): Promise<FreemanEdlsFullResetResult>;
}

async function count(table: AnyPgTable): Promise<number> {
  try {
    const [row] = await getClient()
      .select({ count: sql<number>`count(*)::int` })
      .from(table);
    return row?.count ?? 0;
  } catch (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
}

async function readCounts(): Promise<FreemanEdlsFullResetCounts> {
  return {
    workers: await count(workers),
    sheets: await count(edlsSheets),
    crews: await count(edlsCrews),
    assignments: await count(edlsAssignments),
  };
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type ForeignKey = {
  schema: string;
  table: string;
  column: string;
  constraint: string;
  deleteAction: string;
};

async function readForeignKeys(target: "workers" | "contacts"): Promise<ForeignKey[]> {
  // Lightweight storage mocks used by callers that only exercise the
  // destructive ordering do not expose the catalog executor. Production
  // PostgreSQL clients always do; treating the absent executor as an empty
  // catalog keeps those isolated tests backwards-compatible.
  if (typeof (getClient() as { execute?: unknown }).execute !== "function") return [];
  const result = await getClient().execute(sql`
    SELECT
      ns.nspname AS schema,
      rel.relname AS table,
      att.attname AS column,
      con.conname AS constraint,
      con.confdeltype AS "deleteAction"
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = con.conkey[1]
    JOIN pg_class target_rel ON target_rel.oid = con.confrelid
    WHERE con.contype = 'f'
      AND con.convalidated
      AND array_length(con.conkey, 1) = 1
      AND target_rel.relname = ${target}
      AND target_rel.relnamespace = 'public'::regnamespace
    ORDER BY ns.nspname, rel.relname, con.conname
  `);
  return result.rows as ForeignKey[];
}

async function readRelationRows(
  foreignKey: ForeignKey,
  ids: string[],
): Promise<Array<{ id: string; targetId: string; label: string | null }>> {
  if (ids.length === 0) return [];
  const table = `${quoteIdentifier(foreignKey.schema)}.${quoteIdentifier(foreignKey.table)}`;
  const column = quoteIdentifier(foreignKey.column);
  const values = ids.map(quoteLiteral).join(", ");
  const result = await getClient().execute(sql.raw(`
    SELECT
      COALESCE(to_jsonb(r)->>'id', '') AS id,
      r.${column} AS "targetId",
      COALESCE(
        to_jsonb(r)->>'name',
        to_jsonb(r)->>'display_name',
        to_jsonb(r)->>'title',
        to_jsonb(r)->>'sirius_id'
      ) AS label
    FROM ${table} r
    WHERE r.${column} IN (${values})
    ORDER BY id
  `));
  return result.rows as Array<{ id: string; targetId: string; label: string | null }>;
}

const ownedContactTables = new Set(["contact_postal", "contact_phone", "contact_numbers"]);
const explicitlyDeletedWorkerTables = new Set(["grievance_workers"]);

async function readPlan(): Promise<FreemanEdlsFullResetPlan> {
  const counts = await readCounts();
  const client = getClient();
  const workerRows = await client.select({ id: workers.id, contactId: workers.contactId }).from(workers);
  const workerIds = workerRows.map((row) => row.id);
  const contactIds = [...new Set(workerRows.map((row) => row.contactId))];
  const workerByContact = new Map(workerRows.map((row) => [row.contactId, row.id]));
  const contactByWorker = new Map(workerRows.map((row) => [row.id, row.contactId]));
  const contactRows = typeof (client as { execute?: unknown }).execute === "function" && contactIds.length > 0
    ? await client.select({ id: contacts.id, displayName: contacts.displayName })
      .from(contacts).where(idMatchesAny(contacts.id, contactIds))
    : [];
  const contactNames = new Map(contactRows.map((row) => [row.id, row.displayName]));
  const workerNames = new Map(workerRows.map((row) => [
    row.id,
    contactNames.get(row.contactId) ?? null,
  ]));
  const blockers: FreemanEdlsFullResetRelation[] = [];
  const preservations: FreemanEdlsFullResetRelation[] = [];
  if (typeof (client as { execute?: unknown }).execute !== "function" && contactIds.length > 0) {
    const communicationRows = await client
      .select({ contactId: comm.contactId })
      .from(comm)
      .where(idMatchesAny(comm.contactId, contactIds));
    for (const row of communicationRows) {
      preservations.push({
        entity: "contact",
        workerId: workerByContact.get(row.contactId),
        contactId: row.contactId,
        relationshipType: "foreign_key",
        referencingSchema: "public",
        referencingTable: "comm",
        referencingColumn: "contact_id",
        recordId: row.contactId,
        label: null,
        constraint: "comm_contact_id_fkey",
        workerName: workerNames.get(workerByContact.get(row.contactId) ?? "") ?? null,
        contactName: contactNames.get(row.contactId) ?? null,
        disposition: "anonymized",
      });
    }
  }

  // The worker row owns its contact. It is intentionally not treated as a
  // preservation relation, and owned contact data is deleted separately.
  for (const target of ["workers", "contacts"] as const) {
    const foreignKeys = await readForeignKeys(target);
    for (const foreignKey of foreignKeys) {
      if (target === "workers" && foreignKey.table === "workers") continue;
      if (target === "contacts" && foreignKey.table === "workers") continue;
      if (target === "workers" && explicitlyDeletedWorkerTables.has(foreignKey.table)) continue;
      const ids = target === "workers" ? workerIds : contactIds;
      const rows = await readRelationRows(foreignKey, ids);
      for (const row of rows) {
        const contactId = target === "contacts" ? row.targetId : undefined;
        const workerContactId = target === "workers" ? contactByWorker.get(row.targetId) : undefined;
        const relation: FreemanEdlsFullResetRelation = {
          entity: target === "workers" ? "worker" : "contact",
          ...(target === "workers"
            ? { workerId: row.targetId, contactId: workerContactId }
            : { contactId }),
          relationshipType: "foreign_key",
          referencingSchema: foreignKey.schema,
          referencingTable: foreignKey.table,
          referencingColumn: foreignKey.column,
          recordId: row.id,
          label: row.label,
          constraint: foreignKey.constraint,
          workerName: target === "workers" ? workerNames.get(row.targetId) ?? null : null,
          contactName: target === "workers" && workerContactId
            ? contactNames.get(workerContactId) ?? null
            : null,
          disposition: target === "workers"
            ? "blocker"
            : (foreignKey.table === "comm" ? "anonymized" : "intact"),
        };
        if (target === "workers" && foreignKey.deleteAction !== "c") blockers.push(relation);
        else if (target === "contacts" && !ownedContactTables.has(foreignKey.table)) preservations.push(relation);
      }
    }
  }
  // Attach the owning worker to contact preservation rows deterministically.
  for (const relation of preservations) {
    if (relation.contactId) {
      relation.workerId = workerByContact.get(relation.contactId);
      relation.workerName = workerNames.get(relation.workerId ?? "") ?? null;
      relation.contactName = contactNames.get(relation.contactId) ?? null;
    }
  }
  const intactContacts = new Set(
    preservations.filter((relation) => relation.referencingTable !== "comm" && relation.contactId)
      .map((relation) => relation.contactId as string),
  );
  for (const relation of preservations) {
    if (relation.contactId && intactContacts.has(relation.contactId)) relation.disposition = "intact";
  }
  const relationOrder = (left: FreemanEdlsFullResetRelation, right: FreemanEdlsFullResetRelation) =>
    [
      left.entity,
      left.referencingSchema,
      left.referencingTable,
      left.referencingColumn,
      left.constraint,
      left.recordId,
      left.workerId ?? "",
      left.contactId ?? "",
    ].join("\u0000").localeCompare([
      right.entity,
      right.referencingSchema,
      right.referencingTable,
      right.referencingColumn,
      right.constraint,
      right.recordId,
      right.workerId ?? "",
      right.contactId ?? "",
    ].join("\u0000"));
  blockers.sort(relationOrder);
  preservations.sort(relationOrder);
  return { counts, blockers, preservations };
}

export class FreemanEdlsFullResetCountsChangedError extends Error {
  constructor() {
    super("Freeman EDLS full reset counts changed");
    this.name = "FreemanEdlsFullResetCountsChangedError";
  }
}

export type FreemanEdlsFullResetStage =
  | "read_counts"
  | "read_workers"
  | "delete_assignments"
  | "delete_crews"
  | "delete_sheets"
  | "delete_worker_edls"
  | "delete_grievance_links"
  | "delete_workers"
  | "delete_contact_postal"
  | "delete_phone_numbers"
  | "delete_contacts"
  | "anonymize_contacts";

export class FreemanEdlsFullResetRelationshipError extends Error {
  constructor(
    public readonly entity: "worker" | "contact",
    public readonly stage: FreemanEdlsFullResetStage,
    public readonly metadata: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(
      entity === "worker"
        ? "Worker records are still referenced by other data."
        : "Worker contact records are still referenced by other data.",
      options,
    );
    this.name = "FreemanEdlsFullResetRelationshipError";
  }
}

export class FreemanEdlsFullResetUnexpectedError extends Error {
  constructor(
    public readonly stage: FreemanEdlsFullResetStage,
    public readonly diagnostics: Record<string, unknown> = {},
    public readonly failedRecord?: FreemanEdlsFullResetFailedRecord,
    options?: ErrorOptions,
  ) {
    super("Freeman EDLS full reset failed", options);
    this.name = "FreemanEdlsFullResetUnexpectedError";
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23503";
}

function safeDatabaseDiagnostics(error: unknown): Record<string, string | undefined> {
  const keys = [
    "name",
    "code",
    "severity",
    "schema",
    "table",
    "column",
    "dataType",
    "constraint",
    "routine",
  ] as const;
  const diagnostics: Record<string, string> = {};
  const seen = new Set<unknown>();
  let current = error;
  for (
    let depth = 0;
    current && typeof current === "object" && depth < 8 && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    for (const key of keys) {
      if (typeof value[key] === "string") diagnostics[key] = value[key];
    }
    current = value.cause;
  }
  return diagnostics;
}

export interface FreemanEdlsFullResetFailedRecord {
  stage: FreemanEdlsFullResetStage;
  table: string;
  id: string;
  worker?: {
    id: string;
    contactId: string;
  };
}

class FreemanEdlsFullResetRecordMutationError extends Error {
  constructor(
    public readonly stage: FreemanEdlsFullResetStage,
    public readonly failedRecord: FreemanEdlsFullResetFailedRecord,
    public readonly databaseError: unknown,
  ) {
    super(`Full reset failed on ${failedRecord.table} record ${failedRecord.id}`, {
      cause: databaseError,
    });
    this.name = "FreemanEdlsFullResetRecordMutationError";
  }
}

function idMatchesAny(column: AnyColumn, ids: string[]) {
  const arrayLiteral = `{${ids.map((id) =>
    `"${id.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
  return sql`${column} = ANY(${arrayLiteral}::varchar[])`;
}

const RESET_BATCH_SIZE = 500;
const MAX_REPORTED_FAILURES = 100;

function isMissingTable(error: unknown): boolean {
  return safeDatabaseDiagnostics(error).code === "42P01";
}

async function tableExists(tableName: string): Promise<boolean> {
  const client = getClient() as { execute?: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };
  if (typeof client.execute !== "function") return true;
  const result = await client.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS "exists"`);
  return (result.rows[0] as { exists?: boolean } | undefined)?.exists === true;
}

async function mutateBestEffort(
  stage: FreemanEdlsFullResetStage,
  table: string,
  rows: Array<Record<string, unknown> & { id: string }>,
  mutate: (ids: string[]) => Promise<Array<{ id: string } & Record<string, unknown>>>,
  workerDetails?: Map<string, FreemanEdlsFullResetFailedRecord["worker"]>,
): Promise<{
  count: number;
  ids: string[];
  changedRows: Array<{ id: string } & Record<string, unknown>>;
  failures: FreemanEdlsFullResetFailure[];
}> {
  let count = 0;
  const ids: string[] = [];
  const changedRows: Array<{ id: string } & Record<string, unknown>> = [];
  const failures: FreemanEdlsFullResetFailure[] = [];

  async function apply(candidates: typeof rows): Promise<void> {
    if (candidates.length === 0) return;
    try {
      const changed = await runInTransaction(() => mutate(candidates.map((row) => row.id)));
      count += changed.length;
      ids.push(...changed.map((row) => row.id));
      changedRows.push(...changed);
    } catch (error) {
      if (isMissingTable(error)) {
        failures.push({ stage, table, diagnostics: safeDatabaseDiagnostics(error), reason: "missing_table" });
        return;
      }
      if (candidates.length === 1) {
        const row = candidates[0];
        failures.push({
          stage,
          table,
          id: row.id,
          worker: workerDetails?.get(row.id),
          diagnostics: safeDatabaseDiagnostics(error),
          reason: "record_failed",
        });
        return;
      }
      const midpoint = Math.ceil(candidates.length / 2);
      await apply(candidates.slice(0, midpoint));
      await apply(candidates.slice(midpoint));
    }
  }

  for (let offset = 0; offset < rows.length; offset += RESET_BATCH_SIZE) {
    await apply(rows.slice(offset, offset + RESET_BATCH_SIZE));
  }
  return { count, ids, changedRows, failures };
}

export function createFreemanEdlsFullResetStorage(): FreemanEdlsFullResetStorage {
  return {
    async getCounts() {
      return runInTransaction(readCounts);
    },

    async getPlan() {
      return runInTransaction(readPlan);
    },

    async execute(expected) {
      const expectedPlan = "blockers" in expected ? expected : {
        counts: expected, blockers: [], preservations: [],
      };
      let currentPlan: FreemanEdlsFullResetPlan;
      try {
        currentPlan = await readPlan();
      } catch (error) {
        throw new FreemanEdlsFullResetUnexpectedError("read_counts", safeDatabaseDiagnostics(error), undefined, { cause: error });
      }
      const stalePreflight = JSON.stringify(currentPlan) !== JSON.stringify(expectedPlan);
      const failures: FreemanEdlsFullResetFailure[] = [];
      const deleted = {
        workers: 0, sheets: 0, crews: 0, assignments: 0, workerEdls: 0,
        grievanceAssociations: 0, contactsDeleted: 0, contactsAnonymized: 0,
      };

      async function readRows<T extends { id: string }>(
        stage: FreemanEdlsFullResetStage,
        table: string,
        read: () => Promise<T[]>,
      ): Promise<T[]> {
        try {
          return await read();
        } catch (error) {
          failures.push({
            stage, table, diagnostics: safeDatabaseDiagnostics(error),
            reason: isMissingTable(error) ? "missing_table" : "stage_failed",
          });
          return [];
        }
      }

      const workerRows = await readRows("read_workers", "workers", () => getClient()
        .select({ id: workers.id, contactId: workers.contactId }).from(workers));
        const workerIds = workerRows.map((row) => row.id);
        const contactIds = [...new Set(workerRows.map((row) => row.contactId))];
        const intactContactIds = [...new Set(
          currentPlan.preservations
            .filter((relation) => relation.entity === "contact" && relation.contactId && relation.disposition === "intact")
            .map((relation) => relation.contactId as string),
        )];
        const anonymizedContactIds = [...new Set(
          currentPlan.preservations
            .filter((relation) => relation.entity === "contact" && relation.contactId && relation.disposition === "anonymized")
            .map((relation) => relation.contactId as string),
        )].filter((id) => !intactContactIds.includes(id));
        const deletableContactIds = contactIds.filter((id) =>
          !intactContactIds.includes(id) && !anonymizedContactIds.includes(id));
      async function purge(
        stage: FreemanEdlsFullResetStage,
        table: string,
        rows: Array<{ id: string }>,
        mutate: (ids: string[]) => Promise<Array<{ id: string } & Record<string, unknown>>>,
        details?: Map<string, FreemanEdlsFullResetFailedRecord["worker"]>,
      ) {
        const result = await mutateBestEffort(stage, table, rows, mutate, details);
        failures.push(...result.failures);
        return result;
      }

      const assignmentRows = await readRows("delete_assignments", "edls_assignments", () =>
        getClient().select({ id: edlsAssignments.id }).from(edlsAssignments));
      deleted.assignments = (await purge("delete_assignments", "edls_assignments", assignmentRows,
          (ids) => getClient().delete(edlsAssignments)
            .where(idMatchesAny(edlsAssignments.id, ids))
            .returning({ id: edlsAssignments.id }))).count;
      const crewRows = await readRows("delete_crews", "edls_crews", () =>
        getClient().select({ id: edlsCrews.id }).from(edlsCrews));
      deleted.crews = (await purge("delete_crews", "edls_crews", crewRows,
          (ids) => getClient().delete(edlsCrews)
            .where(idMatchesAny(edlsCrews.id, ids))
            .returning({ id: edlsCrews.id }))).count;
      const sheetRows = await readRows("delete_sheets", "edls_sheets", () =>
        getClient().select({ id: edlsSheets.id }).from(edlsSheets));
      deleted.sheets = (await purge("delete_sheets", "edls_sheets", sheetRows,
          (ids) => getClient().delete(edlsSheets)
            .where(idMatchesAny(edlsSheets.id, ids))
            .returning({ id: edlsSheets.id }))).count;
      const workerEdlsRows = await readRows("delete_worker_edls", "worker_edls", () =>
        getClient().select({ id: workerEdls.id }).from(workerEdls));
      deleted.workerEdls = (await purge("delete_worker_edls", "worker_edls", workerEdlsRows,
          (ids) => getClient().delete(workerEdls)
            .where(idMatchesAny(workerEdls.id, ids))
            .returning({ id: workerEdls.id }))).count;
      const grievanceLinkRows = await readRows("delete_grievance_links", "grievance_workers", () =>
        getClient().select({ id: grievanceWorkers.id }).from(grievanceWorkers));
      deleted.grievanceAssociations = (await purge("delete_grievance_links", "grievance_workers", grievanceLinkRows,
          (ids) => getClient().delete(grievanceWorkers)
            .where(idMatchesAny(grievanceWorkers.id, ids))
            .returning({ id: grievanceWorkers.id }))).count;
      const fullWorkerRows = await readRows("read_workers", "workers", () => getClient().select().from(workers));
        const workerDetails = new Map<string, FreemanEdlsFullResetFailedRecord["worker"]>(
          fullWorkerRows.map((row) => [row.id, {
            id: row.id,
            contactId: row.contactId,
          }]),
        );
      const deletableContactIdSet = new Set(deletableContactIds);
      const anonymizedContactIdSet = new Set(anonymizedContactIds);
      const intactContactIdSet = new Set(intactContactIds);
      const hasContactPostal = await tableExists("contact_postal");
      const hasContactPhone = await tableExists("contact_phone");
      if (!hasContactPostal) {
        failures.push({
          stage: "delete_contact_postal",
          table: "contact_postal",
          diagnostics: { code: "42P01", table: "contact_postal" },
          reason: "missing_table",
        });
      }
      if (!hasContactPhone) {
        failures.push({
          stage: "delete_phone_numbers",
          table: "contact_phone",
          diagnostics: { code: "42P01", table: "contact_phone" },
          reason: "missing_table",
        });
      }
      const workerResult = await purge("delete_workers", "workers", fullWorkerRows,
        async (ids) => {
          const client = getClient();
          const deletedWorkerRows = await client.delete(workers)
            .where(idMatchesAny(workers.id, ids))
            .returning({ id: workers.id, contactId: workers.contactId });
          const changedContactIds = [...new Set(deletedWorkerRows.map((row) => row.contactId))];
          const detailContactIds = changedContactIds.filter((id) =>
            deletableContactIdSet.has(id) || anonymizedContactIdSet.has(id));
          if (detailContactIds.length > 0) {
            if (hasContactPostal) {
              await client.delete(contactPostal)
                .where(idMatchesAny(contactPostal.contactId, detailContactIds));
            }
            if (hasContactPhone) {
              await client.delete(phoneNumbers)
                .where(idMatchesAny(phoneNumbers.contactId, detailContactIds));
            }
          }
          const contactsToDelete = changedContactIds.filter((id) => deletableContactIdSet.has(id));
          const deletedContactIds = contactsToDelete.length > 0
            ? (await client.delete(contacts)
              .where(idMatchesAny(contacts.id, contactsToDelete))
              .returning({ id: contacts.id })).map((row) => row.id)
            : [];
          const contactsToAnonymize = changedContactIds.filter((id) => anonymizedContactIdSet.has(id));
          const anonymizedContactIdsForBatch = contactsToAnonymize.length > 0
            ? (await client.update(contacts)
              .set({
                title: null,
                given: null,
                middle: null,
                family: null,
                generational: null,
                credentials: null,
                displayName: "Deleted worker",
                email: null,
                birthDate: null,
                gender: null,
                genderNota: null,
                genderCalc: null,
              })
              .where(idMatchesAny(contacts.id, contactsToAnonymize))
              .returning({ id: contacts.id })).map((row) => row.id)
            : [];
          const deletedContactSet = new Set(deletedContactIds);
          const anonymizedContactSet = new Set(anonymizedContactIdsForBatch);
          return deletedWorkerRows.map((row) => ({
            id: row.id,
            contactId: row.contactId,
            contactDeleted: deletedContactSet.has(row.contactId),
            contactAnonymized: anonymizedContactSet.has(row.contactId),
            contactPreserved: intactContactIdSet.has(row.contactId),
          }));
        },
          workerDetails,
        );
      deleted.workers = workerResult.count;
      deleted.contactsDeleted = new Set(workerResult.changedRows
        .filter((row) => row.contactDeleted === true)
        .map((row) => row.contactId as string)).size;
      deleted.contactsAnonymized = new Set(workerResult.changedRows
        .filter((row) => row.contactAnonymized === true)
        .map((row) => row.contactId as string)).size;
      const contactsPreserved = new Set(workerResult.changedRows
        .filter((row) => row.contactPreserved === true)
        .map((row) => row.contactId as string)).size;
      for (const workerId of workerResult.ids) {
        void eventBus.emit(EventType.WORKER_DELETE_AFTER, { workerId });
      }
      const remaining = {
        ...await readCounts(),
        workerEdls: await count(workerEdls),
        grievanceAssociations: await count(grievanceWorkers),
      };
      return {
        ...deleted,
        contactsPreserved,
        remaining,
        failures: failures.slice(0, MAX_REPORTED_FAILURES),
        stalePreflight,
      };
    },
  };
}
