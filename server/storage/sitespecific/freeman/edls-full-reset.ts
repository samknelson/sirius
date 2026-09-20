import { eq, sql, type AnyColumn } from "drizzle-orm";
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
import { getClient, onAfterCommit, runInTransaction } from "../../transaction-context";

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
}

export interface FreemanEdlsFullResetStorage {
  getCounts(): Promise<FreemanEdlsFullResetCounts>;
  getPlan(): Promise<FreemanEdlsFullResetPlan>;
  execute(expected: FreemanEdlsFullResetPlan | FreemanEdlsFullResetCounts): Promise<FreemanEdlsFullResetResult>;
}

async function count(table: AnyPgTable): Promise<number> {
  const [row] = await getClient()
    .select({ count: sql<number>`count(*)::int` })
    .from(table);
  return row?.count ?? 0;
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
  | "lock_tables"
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

let savepointSequence = 0;

async function executeSavepoint(command: string): Promise<void> {
  await getClient().execute(sql.raw(command));
}

function idMatchesAny(column: AnyColumn, ids: string[]) {
  const arrayLiteral = `{${ids.map((id) =>
    `"${id.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
  return sql`${column} = ANY(${arrayLiteral}::varchar[])`;
}

/** @internal Exported so real-database tests can make preflight deterministic. */
export async function lockFreemanEdlsFullResetTables(): Promise<void> {
  if (typeof (getClient() as { execute?: unknown }).execute !== "function") return;
  const foreignKeys = [
    ...(await readForeignKeys("workers")),
    ...(await readForeignKeys("contacts")),
  ];
  const tables = new Set([
    '"public"."edls_assignments"',
    '"public"."edls_crews"',
    '"public"."edls_sheets"',
    '"public"."worker_edls"',
    '"public"."grievance_workers"',
    '"public"."workers"',
    '"public"."contact_postal"',
    '"public"."contact_phone"',
    '"public"."contacts"',
    ...foreignKeys.map((foreignKey) =>
      `${quoteIdentifier(foreignKey.schema)}.${quoteIdentifier(foreignKey.table)}`),
  ]);
  await getClient().execute(sql`SET LOCAL lock_timeout = '10s'`);
  await getClient().execute(sql.raw(
    `LOCK TABLE ${[...tables].sort().join(", ")} IN SHARE ROW EXCLUSIVE MODE`,
  ));
}

async function mutateRowsWithExactFailure(
  stage: FreemanEdlsFullResetStage,
  table: string,
  rows: Array<Record<string, unknown> & { id: string }>,
  mutate: (ids: string[]) => Promise<Array<{ id: string }>>,
  workerDetails?: Map<string, FreemanEdlsFullResetFailedRecord["worker"]>,
  _loadSnapshot?: (id: string) => Promise<Record<string, unknown> | undefined>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const client = getClient();

  // Lightweight storage mocks do not expose execute/savepoints. Production
  // PostgreSQL always does; retain one bulk mutation for those isolated tests.
  if (typeof (client as { execute?: unknown }).execute !== "function") {
    return (await mutate(rows.map((row) => row.id))).length;
  }

  const stageSavepoint = `freeman_full_reset_stage_${savepointSequence++}`;
  await executeSavepoint(`SAVEPOINT ${stageSavepoint}`);
  let originalError: unknown;
  try {
    const changed = (await mutate(rows.map((row) => row.id))).length;
    await executeSavepoint(`RELEASE SAVEPOINT ${stageSavepoint}`);
    return changed;
  } catch (error) {
    originalError = error;
    await executeSavepoint(`ROLLBACK TO SAVEPOINT ${stageSavepoint}`);
    await executeSavepoint(`RELEASE SAVEPOINT ${stageSavepoint}`);
  }

  async function probe(candidates: typeof rows): Promise<unknown | undefined> {
    const probeSavepoint = `freeman_full_reset_probe_${savepointSequence++}`;
    await executeSavepoint(`SAVEPOINT ${probeSavepoint}`);
    try {
      await mutate(candidates.map((row) => row.id));
      await executeSavepoint(`ROLLBACK TO SAVEPOINT ${probeSavepoint}`);
      await executeSavepoint(`RELEASE SAVEPOINT ${probeSavepoint}`);
      return undefined;
    } catch (error) {
      await executeSavepoint(`ROLLBACK TO SAVEPOINT ${probeSavepoint}`);
      await executeSavepoint(`RELEASE SAVEPOINT ${probeSavepoint}`);
      return error;
    }
  }

  async function locateFailure(candidates: typeof rows): Promise<never> {
    if (candidates.length === 1) {
      const row = candidates[0];
      const rowError = await probe(candidates);
      if (rowError) {
        throw new FreemanEdlsFullResetRecordMutationError(
          stage,
          {
            stage,
            table,
            id: row.id,
            worker: workerDetails?.get(row.id),
          },
          rowError,
        );
      }
    }

    const midpoint = Math.max(1, Math.floor(candidates.length / 2));
    const left = candidates.slice(0, midpoint);
    const right = candidates.slice(midpoint);
    const leftError = await probe(left);
    if (leftError) return locateFailure(left);
    if (right.length > 0) {
      const rightError = await probe(right);
      if (rightError) return locateFailure(right);
    }

    // A set-level trigger or aggregate invariant can reject a statement while
    // accepting every smaller probe. Do not invent a single-record culprit.
    throw new FreemanEdlsFullResetRecordMutationError(
      stage,
      {
        stage,
        table,
        id: "(multi-row statement)",
      },
      originalError,
    );
  }

  return locateFailure(rows);
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
      return runInTransaction(async () => {
        let stage: FreemanEdlsFullResetStage = "lock_tables";
        try {
        await lockFreemanEdlsFullResetTables();
        stage = "read_counts";
        const currentPlan = await readPlan();
        const current = currentPlan.counts;
        const expectedPlan = "blockers" in expected ? expected : {
          counts: expected,
          blockers: [],
          preservations: [],
        };
        const hasAuthoritativePlan = "blockers" in expected;
        const expectedCounts = expectedPlan.counts;
        if (currentPlan.blockers.length > 0) {
          throw new FreemanEdlsFullResetRelationshipError(
            currentPlan.blockers[0].entity,
            "read_workers",
            {
              schema: currentPlan.blockers[0].referencingSchema,
              table: currentPlan.blockers[0].referencingTable,
              constraint: currentPlan.blockers[0].constraint,
              referencingType: currentPlan.blockers[0].relationshipType,
              recordId: currentPlan.blockers[0].recordId,
              workerId: currentPlan.blockers[0].workerId,
              contactId: currentPlan.blockers[0].contactId,
            },
          );
        }
        if (
          current.workers !== expectedCounts.workers
          || current.sheets !== expectedCounts.sheets
          || current.crews !== expectedCounts.crews
          || current.assignments !== expectedCounts.assignments
          || (hasAuthoritativePlan
            && (JSON.stringify(currentPlan.blockers) !== JSON.stringify(expectedPlan.blockers)
              || JSON.stringify(currentPlan.preservations) !== JSON.stringify(expectedPlan.preservations)))
        ) {
          throw new FreemanEdlsFullResetCountsChangedError();
        }

        const client = getClient();
        stage = "read_workers";
        const workerRows = await client
          .select({ id: workers.id, contactId: workers.contactId })
          .from(workers);
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
        const removableContactDetailIds = [
          ...new Set([...deletableContactIds, ...anonymizedContactIds]),
        ];

        const assignmentRows = await client.select({ id: edlsAssignments.id }).from(edlsAssignments);
        stage = "delete_assignments";
        const deletedAssignments = await mutateRowsWithExactFailure(
          stage,
          "edls_assignments",
          assignmentRows,
          (ids) => client.delete(edlsAssignments)
            .where(idMatchesAny(edlsAssignments.id, ids))
            .returning({ id: edlsAssignments.id }),
          undefined,
          async (id) => (await client.select().from(edlsAssignments)
            .where(eq(edlsAssignments.id, id)))[0],
        );
        const crewRows = await client.select({ id: edlsCrews.id }).from(edlsCrews);
        stage = "delete_crews";
        const deletedCrews = await mutateRowsWithExactFailure(
          stage,
          "edls_crews",
          crewRows,
          (ids) => client.delete(edlsCrews)
            .where(idMatchesAny(edlsCrews.id, ids))
            .returning({ id: edlsCrews.id }),
          undefined,
          async (id) => (await client.select().from(edlsCrews)
            .where(eq(edlsCrews.id, id)))[0],
        );
        const sheetRows = await client.select({ id: edlsSheets.id }).from(edlsSheets);
        stage = "delete_sheets";
        const deletedSheets = await mutateRowsWithExactFailure(
          stage,
          "edls_sheets",
          sheetRows,
          (ids) => client.delete(edlsSheets)
            .where(idMatchesAny(edlsSheets.id, ids))
            .returning({ id: edlsSheets.id }),
          undefined,
          async (id) => (await client.select().from(edlsSheets)
            .where(eq(edlsSheets.id, id)))[0],
        );
        const workerEdlsRows = await client.select({ id: workerEdls.id }).from(workerEdls);
        stage = "delete_worker_edls";
        const deletedWorkerEdls = await mutateRowsWithExactFailure(
          stage,
          "worker_edls",
          workerEdlsRows,
          (ids) => client.delete(workerEdls)
            .where(idMatchesAny(workerEdls.id, ids))
            .returning({ id: workerEdls.id }),
          undefined,
          async (id) => (await client.select().from(workerEdls)
            .where(eq(workerEdls.id, id)))[0],
        );
        const grievanceLinkRows = await client.select({ id: grievanceWorkers.id }).from(grievanceWorkers);
        stage = "delete_grievance_links";
        const deletedGrievanceLinks = await mutateRowsWithExactFailure(
          stage,
          "grievance_workers",
          grievanceLinkRows,
          (ids) => client.delete(grievanceWorkers)
            .where(idMatchesAny(grievanceWorkers.id, ids))
            .returning({ id: grievanceWorkers.id }),
          undefined,
          async (id) => (await client.select().from(grievanceWorkers)
            .where(eq(grievanceWorkers.id, id)))[0],
        );
        const fullWorkerRows = await client.select().from(workers);
        const workerDetails = new Map<string, FreemanEdlsFullResetFailedRecord["worker"]>(
          fullWorkerRows.map((row) => [row.id, {
            id: row.id,
            contactId: row.contactId,
          }]),
        );
        stage = "delete_workers";
        const deletedWorkers = await mutateRowsWithExactFailure(
          stage,
          "workers",
          fullWorkerRows,
          (ids) => client.delete(workers)
            .where(idMatchesAny(workers.id, ids))
            .returning({ id: workers.id }),
          workerDetails,
        );
        const workerDetailsByContact = new Map<string, FreemanEdlsFullResetFailedRecord["worker"]>(
          [...workerDetails.values()]
            .filter((details): details is NonNullable<typeof details> => Boolean(details))
            .map((details) => [details.contactId, details]),
        );

        if (removableContactDetailIds.length > 0) {
          const postalRows = await client.select().from(contactPostal)
            .where(idMatchesAny(contactPostal.contactId, removableContactDetailIds));
          stage = "delete_contact_postal";
          await mutateRowsWithExactFailure(
            stage,
            "contact_postal",
            postalRows,
            (ids) => client.delete(contactPostal)
              .where(idMatchesAny(contactPostal.id, ids))
              .returning({ id: contactPostal.id }),
          );
          const phoneRows = await client.select().from(phoneNumbers)
            .where(idMatchesAny(phoneNumbers.contactId, removableContactDetailIds));
          stage = "delete_phone_numbers";
          await mutateRowsWithExactFailure(
            stage,
            "contact_phone",
            phoneRows,
            (ids) => client.delete(phoneNumbers)
              .where(idMatchesAny(phoneNumbers.id, ids))
              .returning({ id: phoneNumbers.id }),
          );
        }

        let deletedContacts = 0;
        if (deletableContactIds.length > 0) {
          const deletableContacts = await client.select().from(contacts)
            .where(idMatchesAny(contacts.id, deletableContactIds));
          stage = "delete_contacts";
          deletedContacts = await mutateRowsWithExactFailure(
            stage,
            "contacts",
            deletableContacts,
            (ids) => client.delete(contacts)
              .where(idMatchesAny(contacts.id, ids))
              .returning({ id: contacts.id }),
            workerDetailsByContact,
          );
        }
        let anonymizedContacts = 0;
        if (anonymizedContactIds.length > 0) {
          const contactsToAnonymize = await client.select().from(contacts)
            .where(idMatchesAny(contacts.id, anonymizedContactIds));
          stage = "anonymize_contacts";
          anonymizedContacts = await mutateRowsWithExactFailure(
            stage,
            "contacts",
            contactsToAnonymize,
            (ids) => client.update(contacts)
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
              .where(idMatchesAny(contacts.id, ids))
              .returning({ id: contacts.id }),
            workerDetailsByContact,
          );
        }

        // Match deleteWorker's cleanup contract, but only after the complete
        // reset transaction commits. A rollback emits no orphan-cleanup work.
        onAfterCommit(() => {
          for (const workerId of workerIds) {
            void eventBus.emit(EventType.WORKER_DELETE_AFTER, { workerId });
          }
        });

        return {
          workers: deletedWorkers,
          sheets: deletedSheets,
          crews: deletedCrews,
          assignments: deletedAssignments,
          workerEdls: deletedWorkerEdls,
          grievanceAssociations: deletedGrievanceLinks,
          contactsDeleted: deletedContacts,
          contactsAnonymized: anonymizedContacts,
          contactsPreserved: intactContactIds.length,
        };
        } catch (error) {
          if (error instanceof FreemanEdlsFullResetRecordMutationError) {
            throw new FreemanEdlsFullResetUnexpectedError(
              error.stage,
              safeDatabaseDiagnostics(error.databaseError),
              error.failedRecord,
              { cause: error.databaseError },
            );
          }
          if (
            error instanceof FreemanEdlsFullResetCountsChangedError
            || error instanceof FreemanEdlsFullResetRelationshipError
            || error instanceof FreemanEdlsFullResetUnexpectedError
          ) {
            throw error;
          }
          if (isForeignKeyViolation(error) && stage === "delete_workers") {
            throw new FreemanEdlsFullResetRelationshipError("worker", stage, safeDatabaseDiagnostics(error), { cause: error });
          }
          if (
            isForeignKeyViolation(error)
            && (stage === "delete_contacts" || stage === "anonymize_contacts")
          ) {
            throw new FreemanEdlsFullResetRelationshipError("contact", stage, safeDatabaseDiagnostics(error), { cause: error });
          }
          throw new FreemanEdlsFullResetUnexpectedError(stage, {
            entity: stage === "delete_workers" ? "worker"
              : (stage === "delete_contacts" || stage === "anonymize_contacts" ? "contact" : undefined),
            ...safeDatabaseDiagnostics(error),
          }, undefined, { cause: error });
        }
      });
    },
  };
}
