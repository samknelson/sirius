import { inArray, sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import {
  comm,
  contactPostal,
  contacts,
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

export interface FreemanEdlsFullResetResult extends FreemanEdlsFullResetCounts {
  workerEdls: number;
  grievanceAssociations: number;
  contactsDeleted: number;
  contactsAnonymized: number;
}

export interface FreemanEdlsFullResetStorage {
  getCounts(): Promise<FreemanEdlsFullResetCounts>;
  execute(expected: FreemanEdlsFullResetCounts): Promise<FreemanEdlsFullResetResult>;
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

export function createFreemanEdlsFullResetStorage(): FreemanEdlsFullResetStorage {
  return {
    async getCounts() {
      return runInTransaction(readCounts);
    },

    async execute(expected) {
      return runInTransaction(async () => {
        let stage: FreemanEdlsFullResetStage = "read_counts";
        try {
          const current = await readCounts();
        if (
          current.workers !== expected.workers
          || current.sheets !== expected.sheets
          || current.crews !== expected.crews
          || current.assignments !== expected.assignments
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
        const communicationContactRows = contactIds.length === 0
          ? []
          : await client
              .select({ contactId: comm.contactId })
              .from(comm)
              .where(inArray(comm.contactId, contactIds));
        const communicationContactIds = [
          ...new Set(communicationContactRows.map((row) => row.contactId)),
        ];
        const deletableContactIds = contactIds.filter(
          (id) => !communicationContactIds.includes(id),
        );

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

        if (contactIds.length > 0) {
          stage = "delete_contact_postal";
          await client.delete(contactPostal).where(inArray(contactPostal.contactId, contactIds));
          stage = "delete_phone_numbers";
          await client.delete(phoneNumbers).where(inArray(phoneNumbers.contactId, contactIds));
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
        if (communicationContactIds.length > 0) {
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
            .where(inArray(contacts.id, communicationContactIds))
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
            throw new FreemanEdlsFullResetRelationshipError("worker", stage, { cause: error });
          }
          if (
            isForeignKeyViolation(error)
            && (stage === "delete_contacts" || stage === "anonymize_contacts")
          ) {
            throw new FreemanEdlsFullResetRelationshipError("contact", stage, { cause: error });
          }
          throw new FreemanEdlsFullResetUnexpectedError(stage, { cause: error });
        }
      });
    },
  };
}