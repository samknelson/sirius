import type { Request } from "express";
import { storage } from "../../../storage";
import { buildContext, checkAccess } from "../../../services/access-policy-evaluator";
import {
  registerEntityFileContext,
  type EntityFileRecord,
} from "../../../services/entity-files/registry";
import type { InsertFile } from "@shared/schema";
import type { BaoDcDocumentWithFile } from "../../../storage/sitespecific/bao/disability-credit";
import type { PolicyContext } from "@shared/access-policies";

function toRecord(row: BaoDcDocumentWithFile): EntityFileRecord {
  return {
    id: row.id,
    entityId: row.caseId!,
    fileId: row.fileId!,
    name: row.name,
    data: {
      ...(typeof row.data === "object" && row.data ? row.data : {}),
      docType: row.docType,
      uploadedByUserId: row.uploadedByUserId,
      supersededAt: row.supersededAt,
      supersededByUserId: row.supersededByUserId,
    },
    file: row.file!,
  };
}

/**
 * Disability Credit case documents in the generic entity-files framework.
 *
 * Access: staff manage everything; a MEMBER may view and upload (manage) on
 * their OWN case — the worker-centered "member uploads to their case" flow.
 * Documents are NEVER deleted: `remove` always throws; supersession is the
 * only retirement path (dedicated DC route, staff-only).
 */
export function registerBaoDcEntityFileContext(): void {
  const caseAccessible = async (
    entityId: string,
    check: (policyId: string, targetId?: string) => Promise<boolean>,
  ): Promise<boolean> => {
    if (await check("staff")) return true;
    const theCase = await storage.baoDisabilityCredit.getCase(entityId);
    if (!theCase) return false;
    return check("worker.mine", theCase.workerId);
  };

  registerEntityFileContext({
    id: "bao-dc-case",
    label: "Disability Credit cases",
    recordLabel: "Disability Credit case",
    component: "sitespecific.bao",
    tokens: [":worker-id", ":case-id"],

    async entityExists(entityId: string): Promise<boolean> {
      return Boolean(await storage.baoDisabilityCredit.getCase(entityId));
    },

    async resolveTokens(entityId: string): Promise<Record<string, string>> {
      const theCase = await storage.baoDisabilityCredit.getCase(entityId);
      return {
        ":worker-id": theCase?.workerId ?? "unknown",
        ":case-id": entityId,
      };
    },

    async checkAccess(_verb, entityId: string, req: Request): Promise<boolean> {
      const context = await buildContext(req);
      return caseAccessible(entityId, async (policyId, targetId) => {
        const result = await checkAccess(policyId, context.user, targetId);
        return result.granted;
      });
    },

    // Must stay exactly as strict as checkAccess above.
    async checkPolicyAccess(_verb, entityId: string, ctx: PolicyContext): Promise<boolean> {
      return caseAccessible(entityId, (policyId, targetId) =>
        ctx.checkPolicy(policyId, targetId),
      );
    },

    adapter: {
      async list(entityId: string) {
        const rows = await storage.baoDisabilityCredit.listCaseDocumentsWithFiles(entityId);
        return rows.filter((r) => r.fileId && r.file).map(toRecord);
      },
      async get(entityId: string, attachmentId: string) {
        const row = await storage.baoDisabilityCredit.getCaseDocument(entityId, attachmentId);
        return row && row.fileId && row.file ? toRecord(row) : undefined;
      },
      async getByFileId(entityId: string, fileId: string) {
        const row = await storage.baoDisabilityCredit.getCaseDocumentByFileId(entityId, fileId);
        return row && row.file ? toRecord(row) : undefined;
      },
      async attach(entityId: string, file: InsertFile, name: string) {
        const row = await storage.baoDisabilityCredit.attachCaseDocumentWithFile(
          entityId,
          file,
          name,
          { uploadedByUserId: String(file.uploadedBy) },
        );
        return toRecord(row);
      },
      async update() {
        // Classification/rename is checklist-affecting evidence mutation:
        // STAFF-ONLY via the dedicated DC route, which recomputes readiness
        // and may auto-bounce. The generic PATCH would let a member who can
        // upload also reclassify — never allowed.
        throw new Error("DC_DOCUMENT_UPDATE_VIA_DC_ROUTES");
      },
      async remove() {
        // DC documents are auditable evidence: superseded, never deleted.
        throw new Error("DC_DOCUMENTS_CANNOT_BE_DELETED");
      },
    },
  });
}
