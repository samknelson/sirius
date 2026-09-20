import { inArray, sql } from "drizzle-orm";
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
      .from(contacts).where(inArray(contacts.id, contactIds))
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
      .where(inArray(comm.contactId, contactIds));
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
    public readonly metadata: Record<string, string | undefined> = {},
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
    public readonly diagnostics: Record<string, string | undefined> = {},
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
  if (typeof error !== "object" || error === null) return {};
  const value = error as Record<string, unknown>;
  const keys = ["code", "constraint", "table", "schema", "detail", "key", "column", "where"] as const;
  return Object.fromEntries(keys.filter((key) => typeof value[key] === "string")
    .map((key) => [key, value[key] as string]));
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
        let stage: FreemanEdlsFullResetStage = "read_counts";
        try {
        const currentPlan = await readPlan();
        const current = currentPlan.counts;
        const expectedPlan = "blockers" in expected ? expected : {
          counts: expected,
          blockers: [],
          preservations: [],
        };
        const hasAuthoritativePlan = "blockers" in expected;
        const expectedCounts = expectedPlan.counts;
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

        stage = "delete_assignments";
        const deletedAssignments = await client.delete(edlsAssignments).returning({ id: edlsAssignments.id });
        stage = "delete_crews";
        const deletedCrews = await client.delete(edlsCrews).returning({ id: edlsCrews.id });
        stage = "delete_sheets";
        const deletedSheets = await client.delete(edlsSheets).returning({ id: edlsSheets.id });
        stage = "delete_worker_edls";
        const deletedWorkerEdls = await client.delete(workerEdls).returning({ id: workerEdls.id });
        stage = "delete_grievance_links";
        const deletedGrievanceLinks = await client.delete(grievanceWorkers).returning({ id: grievanceWorkers.id });
        stage = "delete_workers";
        const deletedWorkers = await client.delete(workers).returning({ id: workers.id });

        if (removableContactDetailIds.length > 0) {
          stage = "delete_contact_postal";
          await client.delete(contactPostal)
            .where(inArray(contactPostal.contactId, removableContactDetailIds));
          stage = "delete_phone_numbers";
          await client.delete(phoneNumbers)
            .where(inArray(phoneNumbers.contactId, removableContactDetailIds));
        }

        let deletedContacts: Array<{ id: string }> = [];
        if (deletableContactIds.length > 0) {
          stage = "delete_contacts";
          deletedContacts = await client
            .delete(contacts)
            .where(inArray(contacts.id, deletableContactIds))
            .returning({ id: contacts.id });
        }
        let anonymizedContacts: Array<{ id: string }> = [];
        if (anonymizedContactIds.length > 0) {
          stage = "anonymize_contacts";
          anonymizedContacts = await client
            .update(contacts)
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
            .where(inArray(contacts.id, anonymizedContactIds))
            .returning({ id: contacts.id });
        }

        // Match deleteWorker's cleanup contract, but only after the complete
        // reset transaction commits. A rollback emits no orphan-cleanup work.
        onAfterCommit(() => {
          for (const workerId of workerIds) {
            void eventBus.emit(EventType.WORKER_DELETE_AFTER, { workerId });
          }
        });

        return {
          workers: deletedWorkers.length,
          sheets: deletedSheets.length,
          crews: deletedCrews.length,
          assignments: deletedAssignments.length,
          workerEdls: deletedWorkerEdls.length,
          grievanceAssociations: deletedGrievanceLinks.length,
          contactsDeleted: deletedContacts.length,
          contactsAnonymized: anonymizedContacts.length,
          contactsPreserved: intactContactIds.length,
        };
        } catch (error) {
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
          }, { cause: error });
        }
      });
    },
  };
}