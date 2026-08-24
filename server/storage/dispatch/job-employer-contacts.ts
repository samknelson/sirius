import { getClient } from "../transaction-context";
import {
  dispatchJobEmployerContacts,
  dispatchJobs,
  employers,
  contacts,
  type DispatchJobEmployerContact,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

/**
 * Storage for the dispatch job ↔ employer contact associations
 * (`dispatch_job_employer_contacts`, owned by the dispatch component).
 *
 * Deliberately NO business-rule enforcement here: the "contact must belong
 * to the job's employer" rule is route-level only, so existing associations
 * survive a contact later being removed from the employer.
 */

export interface DispatchJobEmployerContactWithContact extends DispatchJobEmployerContact {
  contact: {
    id: string;
    displayName: string;
    email: string | null;
  } | null;
}

export interface DispatchJobEmployerContactsStorage {
  /** Associations for a job, joined with contact details for display. */
  listByJob(jobId: string): Promise<DispatchJobEmployerContactWithContact[]>;
  get(id: string): Promise<DispatchJobEmployerContact | undefined>;
  /** Create an association. Throws 23505 unique violation on duplicates. */
  create(jobId: string, contactId: string): Promise<DispatchJobEmployerContact>;
  /** Delete one association. Returns the deleted row, or undefined. */
  delete(id: string): Promise<DispatchJobEmployerContact | undefined>;
}

async function getJobLabel(jobId: string | undefined): Promise<string> {
  if (!jobId) return "Unknown Job";
  const client = getClient();
  const [row] = await client
    .select({ title: dispatchJobs.title, employerName: employers.name })
    .from(dispatchJobs)
    .leftJoin(employers, eq(dispatchJobs.employerId, employers.id))
    .where(eq(dispatchJobs.id, jobId));
  if (!row) return "Unknown Job";
  return `"${row.title}" (${row.employerName ?? "Unknown Employer"})`;
}

async function getContactName(contactId: string | undefined): Promise<string> {
  if (!contactId) return "Unknown Contact";
  const client = getClient();
  const [row] = await client
    .select({ displayName: contacts.displayName })
    .from(contacts)
    .where(eq(contacts.id, contactId));
  return row?.displayName || "Unknown Contact";
}

export const dispatchJobEmployerContactsLoggingConfig =
  defineLoggingConfig<DispatchJobEmployerContactsStorage>({
    module: "dispatch-job-employer-contacts",
    methods: {
      create: {
        getEntityId: (_args, result) => result?.id,
        getHostEntityId: (args) => args[0],
        getDescription: async (args, _result) => {
          const [jobLabel, contactName] = await Promise.all([
            getJobLabel(args[0]),
            getContactName(args[1]),
          ]);
          return `Associated Employer Contact "${contactName}" with Dispatch Job ${jobLabel}`;
        },
      },
      delete: {
        getEntityId: (args) => args[0],
        getHostEntityId: (_args, result, beforeState) =>
          result?.jobId ?? beforeState?.row?.jobId,
        before: async (args, storage) => ({ row: (await storage.get(args[0])) ?? null }),
        getDescription: async (_args, result, beforeState) => {
          const row = result ?? beforeState?.row;
          const [jobLabel, contactName] = await Promise.all([
            getJobLabel(row?.jobId),
            getContactName(row?.contactId),
          ]);
          return `Removed Employer Contact "${contactName}" from Dispatch Job ${jobLabel}`;
        },
      },
    },
  });

export function createDispatchJobEmployerContactsStorage(): DispatchJobEmployerContactsStorage {
  return {
    async listByJob(jobId: string): Promise<DispatchJobEmployerContactWithContact[]> {
      const client = getClient();
      const rows = await client
        .select({
          link: dispatchJobEmployerContacts,
          contact: {
            id: contacts.id,
            displayName: contacts.displayName,
            email: contacts.email,
          },
        })
        .from(dispatchJobEmployerContacts)
        .leftJoin(contacts, eq(dispatchJobEmployerContacts.contactId, contacts.id))
        .where(eq(dispatchJobEmployerContacts.jobId, jobId))
        .orderBy(contacts.displayName, dispatchJobEmployerContacts.id);
      return rows.map((r) => ({ ...r.link, contact: r.contact || null }));
    },

    async get(id: string): Promise<DispatchJobEmployerContact | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(dispatchJobEmployerContacts)
        .where(eq(dispatchJobEmployerContacts.id, id));
      return row;
    },

    async create(jobId: string, contactId: string): Promise<DispatchJobEmployerContact> {
      const client = getClient();
      const [row] = await client
        .insert(dispatchJobEmployerContacts)
        .values({ jobId, contactId })
        .returning();
      return row;
    },

    async delete(id: string): Promise<DispatchJobEmployerContact | undefined> {
      const client = getClient();
      const [row] = await client
        .delete(dispatchJobEmployerContacts)
        .where(eq(dispatchJobEmployerContacts.id, id))
        .returning();
      return row;
    },
  };
}
