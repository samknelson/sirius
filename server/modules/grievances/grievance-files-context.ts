import type { Request } from "express";
import { storage } from "../../storage";
import { buildContext, checkAccess } from "../../services/access-policy-evaluator";
import {
  registerEntityFileContext,
  type EntityFileRecord,
} from "../../services/entity-files/registry";
import type { InsertFile } from "@shared/schema";
import type { GrievanceFileWithFile } from "../../storage";

function toRecord(row: GrievanceFileWithFile): EntityFileRecord {
  return {
    id: row.id,
    entityId: row.grievanceId,
    fileId: row.fileId,
    name: row.name,
    data: row.data,
    file: row.file,
  };
}

/**
 * Grievance registration for the generic entity-files framework (the pilot
 * context). Both view and manage require the `staff` access policy — the
 * same gate as every other grievance tab; the generic routes additionally
 * enforce the `grievance` component via `component` below.
 */
export function registerGrievanceEntityFileContext(): void {
  registerEntityFileContext({
    id: "grievance",
    label: "Grievances",
    component: "grievance",
    tokens: [":grievance-id"],

    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.grievances.get(entityId));
    },

    async resolveTokens(entityId: string): Promise<Record<string, string>> {
      return { ":grievance-id": entityId };
    },

    async checkAccess(_verb, _entityId, req: Request): Promise<boolean> {
      const context = await buildContext(req);
      const result = await checkAccess("staff", context.user);
      return result.granted;
    },

    // Must stay exactly as strict as checkAccess above: same `staff` policy.
    async checkPolicyAccess(_verb, _entityId, ctx): Promise<boolean> {
      return ctx.checkPolicy("staff");
    },

    adapter: {
      async list(entityId: string) {
        const rows = await storage.grievanceFiles.list(entityId);
        return rows.map(toRecord);
      },
      async get(entityId: string, attachmentId: string) {
        const row = await storage.grievanceFiles.get(entityId, attachmentId);
        return row ? toRecord(row) : undefined;
      },
      async getByFileId(entityId: string, fileId: string) {
        const row = await storage.grievanceFiles.getByFileId(entityId, fileId);
        return row ? toRecord(row) : undefined;
      },
      async attach(entityId: string, file: InsertFile, name: string) {
        const row = await storage.grievanceFiles.createWithFile(entityId, file, name);
        return toRecord(row);
      },
      async update(entityId: string, attachmentId: string, updates) {
        const row = await storage.grievanceFiles.update(entityId, attachmentId, updates);
        return row ? toRecord(row) : undefined;
      },
      async remove(entityId: string, attachmentId: string) {
        const result = await storage.grievanceFiles.deleteWithFile(entityId, attachmentId);
        return result ? { file: result.file } : undefined;
      },
    },
  });
}
