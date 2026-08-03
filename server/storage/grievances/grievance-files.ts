import { getClient, onAfterCommit, runInTransaction } from "../transaction-context";
import {
  grievanceFiles,
  files,
  type GrievanceFile,
  type File,
  type InsertFile,
} from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";
import { fileSystemService } from "../../services/files";
import { logger } from "../../logger";

export interface GrievanceFileWithFile extends GrievanceFile {
  file: File;
}

/**
 * Storage for grievance file attachments (`grievance_files`) — the pilot
 * join-table of the generic entity-files framework. Each attachment row
 * links exactly one `files` row (file_id UNIQUE) to a grievance and carries
 * the user-editable display `name` and freeform `data` jsonb.
 *
 * Transactional contract:
 * - `createWithFile` inserts the files row AND the join row in ONE
 *   transaction (bytes are uploaded by the caller BEFORE this runs; a failed
 *   insert leaves a sweepable orphan object, never a row without bytes).
 * - `deleteWithFile` deletes the join row AND the files row in ONE
 *   transaction — exceptions bubble, no partial deletes. Provider byte
 *   removal is scheduled via onAfterCommit; if it fails the orphan object is
 *   left for the consistency sweep.
 */
export interface GrievanceFileStorage {
  list(grievanceId: string): Promise<GrievanceFileWithFile[]>;
  get(grievanceId: string, attachmentId: string): Promise<GrievanceFileWithFile | undefined>;
  getByFileId(grievanceId: string, fileId: string): Promise<GrievanceFileWithFile | undefined>;
  createWithFile(
    grievanceId: string,
    file: InsertFile,
    name: string,
  ): Promise<GrievanceFileWithFile>;
  update(
    grievanceId: string,
    attachmentId: string,
    updates: { name?: string; data?: unknown },
  ): Promise<GrievanceFileWithFile | undefined>;
  deleteWithFile(
    grievanceId: string,
    attachmentId: string,
  ): Promise<{ attachment: GrievanceFile; file: File } | undefined>;
}

function rowToRecord(row: { grievance_files: GrievanceFile; files: File }): GrievanceFileWithFile {
  return { ...row.grievance_files, file: row.files };
}

export function createGrievanceFileStorage(): GrievanceFileStorage {
  return {
    async list(grievanceId: string): Promise<GrievanceFileWithFile[]> {
      const client = getClient();
      const rows = await client
        .select()
        .from(grievanceFiles)
        .innerJoin(files, eq(grievanceFiles.fileId, files.id))
        .where(eq(grievanceFiles.grievanceId, grievanceId))
        .orderBy(asc(files.uploadedAt), asc(grievanceFiles.id));
      return rows.map(rowToRecord);
    },

    async get(
      grievanceId: string,
      attachmentId: string,
    ): Promise<GrievanceFileWithFile | undefined> {
      const client = getClient();
      const rows = await client
        .select()
        .from(grievanceFiles)
        .innerJoin(files, eq(grievanceFiles.fileId, files.id))
        .where(
          and(
            eq(grievanceFiles.grievanceId, grievanceId),
            eq(grievanceFiles.id, attachmentId),
          ),
        );
      return rows[0] ? rowToRecord(rows[0]) : undefined;
    },

    async getByFileId(
      grievanceId: string,
      fileId: string,
    ): Promise<GrievanceFileWithFile | undefined> {
      const client = getClient();
      const rows = await client
        .select()
        .from(grievanceFiles)
        .innerJoin(files, eq(grievanceFiles.fileId, files.id))
        .where(
          and(
            eq(grievanceFiles.grievanceId, grievanceId),
            eq(grievanceFiles.fileId, fileId),
          ),
        );
      return rows[0] ? rowToRecord(rows[0]) : undefined;
    },

    async createWithFile(
      grievanceId: string,
      file: InsertFile,
      name: string,
    ): Promise<GrievanceFileWithFile> {
      return runInTransaction(async () => {
        const client = getClient();
        const [fileRow] = await client.insert(files).values(file).returning();
        const [attachment] = await client
          .insert(grievanceFiles)
          .values({ grievanceId, fileId: fileRow.id, name })
          .returning();
        return { ...attachment, file: fileRow };
      });
    },

    async update(
      grievanceId: string,
      attachmentId: string,
      updates: { name?: string; data?: unknown },
    ): Promise<GrievanceFileWithFile | undefined> {
      const client = getClient();
      const set: Record<string, unknown> = {};
      if (updates.name !== undefined) set.name = updates.name;
      if (updates.data !== undefined) set.data = updates.data;
      if (Object.keys(set).length === 0) {
        return this.get(grievanceId, attachmentId);
      }
      const [updated] = await client
        .update(grievanceFiles)
        .set(set)
        .where(
          and(
            eq(grievanceFiles.grievanceId, grievanceId),
            eq(grievanceFiles.id, attachmentId),
          ),
        )
        .returning();
      if (!updated) return undefined;
      const [fileRow] = await client.select().from(files).where(eq(files.id, updated.fileId));
      return fileRow ? { ...updated, file: fileRow } : undefined;
    },

    async deleteWithFile(
      grievanceId: string,
      attachmentId: string,
    ): Promise<{ attachment: GrievanceFile; file: File } | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        const [attachment] = await client
          .delete(grievanceFiles)
          .where(
            and(
              eq(grievanceFiles.grievanceId, grievanceId),
              eq(grievanceFiles.id, attachmentId),
            ),
          )
          .returning();
        if (!attachment) return undefined;
        const [fileRow] = await client
          .delete(files)
          .where(eq(files.id, attachment.fileId))
          .returning();
        if (!fileRow) {
          // FK guarantees the files row existed; treat absence as corruption.
          throw new Error(
            `grievance_files row ${attachmentId} pointed at missing files row ${attachment.fileId}`,
          );
        }
        // Byte removal only after the row deletes are durable. A failure
        // here leaves an orphan object for the consistency sweep.
        onAfterCommit(() => {
          void fileSystemService
            .remove(fileRow.fileSystemId, fileRow.storagePath)
            .catch((error) => {
              logger.warn(
                "Attachment rows deleted but object removal failed - orphan object left for sweep",
                {
                  service: "grievanceFiles",
                  fileId: fileRow.id,
                  fileSystemId: fileRow.fileSystemId,
                  storagePath: fileRow.storagePath,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            });
        });
        return { attachment, file: fileRow };
      });
    },
  };
}

export const grievanceFileLoggingConfig: StorageLoggingConfig<GrievanceFileStorage> = {
  module: "grievanceFiles",
  methods: {
    createWithFile: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async (args) => `Attached file "${args[2]}" to grievance`,
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Updated file attachment on grievance`,
    },
    deleteWithFile: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Removed file attachment from grievance`,
    },
  },
};
