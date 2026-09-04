import type { Request } from "express";
import { storage } from "../../../storage";
import { buildContext, checkAccess } from "../../../services/access-policy-evaluator";
import { registerEntityFileContext, type EntityFileRecord } from "../../../services/entity-files/registry";
import type { InsertFile } from "@shared/schema";
import type { PolicyContext } from "@shared/access-policies";

export function registerBaoCaseEntityFileContext(): void {
  const access = async (id: string, ctx: any) => {
    if (await ctx("staff")) return true;
    return false;
  };
  const toRecord = (row: any): EntityFileRecord => ({
    id: row.document.id, entityId: row.document.caseId, fileId: row.document.fileId,
    name: row.file.fileName, data: { documentType: row.document.documentType, uploadedByUserId: row.document.uploadedByUserId },
    file: row.file,
  });
  registerEntityFileContext({
    id: "bao-case", label: "BAO cases", recordLabel: "BAO case", component: "sitespecific.bao",
    tokens: [":entity-id", ":case-id"],
    entityExists: async (id) => Boolean(await storage.baoCases.get(id)),
    resolveTokens: async (id) => {
      const c = await storage.baoCases.get(id);
      return { ":entity-id": c?.entityId ?? "unknown", ":case-id": id };
    },
    async checkAccess(_verb, _id, req: Request) {
      const c = await buildContext(req); return access("", (p: string) => checkAccess(p, c.user).then(r => r.granted));
    },
    async checkPolicyAccess(_verb, _id, ctx: PolicyContext) { return access("", (p: string) => ctx.checkPolicy(p)); },
    adapter: {
      async list(id) { return (await storage.baoCases.listCaseDocuments(id)).map(toRecord); },
      async get(id, attachmentId) { return (await storage.baoCases.listCaseDocuments(id)).find((r: any) => r.document.id === attachmentId) ? toRecord((await storage.baoCases.listCaseDocuments(id)).find((r: any) => r.document.id === attachmentId)) : undefined; },
      async getByFileId(id, fileId) { const r = (await storage.baoCases.listCaseDocuments(id)).find((x: any) => x.document.fileId === fileId); return r ? toRecord(r) : undefined; },
      async attach(id, file: InsertFile) { return toRecord({ document: await storage.baoCases.attachCaseDocument(id, file, String(file.uploadedBy)), file }); },
      async update() { throw new Error("BAO_CASE_DOCUMENTS_CANNOT_BE_UPDATED"); },
      async remove() { throw new Error("BAO_CASE_DOCUMENTS_CANNOT_BE_DELETED"); },
    },
  });
}