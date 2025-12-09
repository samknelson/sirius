import { db } from "../db";
import { esigs, cardchecks, files, type Esig, type InsertEsig, type Cardcheck } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";
import crypto from "crypto";

export interface SignCardcheckParams {
  cardcheckId: string;
  userId: string;
  docRender: string;
  docType: string;
  esigData: any;
  signatureType: string;
  fileId?: string;
}

export interface SignCardcheckResult {
  esig: Esig;
  cardcheck: Cardcheck;
}

export interface EsigStorage {
  getEsigById(id: string): Promise<Esig | undefined>;
  createEsig(data: InsertEsig): Promise<Esig>;
  updateEsig(id: string, data: Partial<InsertEsig>): Promise<Esig | undefined>;
  signCardcheck(params: SignCardcheckParams): Promise<SignCardcheckResult>;
}

export function createEsigStorage(): EsigStorage {
  const storage: EsigStorage = {
    async getEsigById(id: string): Promise<Esig | undefined> {
      const [esig] = await db
        .select()
        .from(esigs)
        .where(eq(esigs.id, id));
      return esig || undefined;
    },

    async createEsig(data: InsertEsig): Promise<Esig> {
      const [esig] = await db
        .insert(esigs)
        .values(data)
        .returning();
      return esig;
    },

    async updateEsig(id: string, data: Partial<InsertEsig>): Promise<Esig | undefined> {
      const [updated] = await db
        .update(esigs)
        .set(data)
        .where(eq(esigs.id, id))
        .returning();
      return updated || undefined;
    },

    async signCardcheck(params: SignCardcheckParams): Promise<SignCardcheckResult> {
      const { cardcheckId, userId, docRender, docType, esigData, signatureType, fileId } = params;
      const docHash = crypto.createHash("sha256").update(docRender).digest("hex");

      return db.transaction(async (tx) => {
        // If signing with an uploaded file, validate file ownership
        if (fileId && signatureType === "upload") {
          const [file] = await tx
            .select()
            .from(files)
            .where(eq(files.id, fileId));
          
          if (!file) {
            throw new Error("Referenced file not found");
          }
          
          if (file.uploadedBy !== userId) {
            throw new Error("You are not authorized to sign with this file");
          }
        }

        const [newEsig] = await tx
          .insert(esigs)
          .values({
            userId,
            status: "signed",
            signedDate: new Date(),
            type: signatureType === "upload" ? "upload" : "online",
            docRender,
            docHash,
            esig: esigData,
            docType,
          })
          .returning();

        // Link the file to the esig if present
        if (fileId && signatureType === "upload") {
          await tx
            .update(files)
            .set({
              entityType: "esig",
              entityId: newEsig.id,
            })
            .where(eq(files.id, fileId));
        }

        const [updatedCardcheck] = await tx
          .update(cardchecks)
          .set({
            status: "signed",
            signedDate: new Date(),
            esigId: newEsig.id,
          })
          .where(eq(cardchecks.id, cardcheckId))
          .returning();

        return { esig: newEsig, cardcheck: updatedCardcheck };
      });
    },
  };

  return storage;
}

export const esigLoggingConfig: StorageLoggingConfig<EsigStorage> = {
  module: 'esigs',
  methods: {
    createEsig: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new esig',
      getHostEntityId: (args, result) => result?.userId || args[0]?.userId,
      getDescription: async (args, result) => {
        return `Created e-signature for document type: ${result?.docType || args[0]?.docType || 'unknown'}`;
      },
      after: async (args, result) => {
        return {
          esig: result,
          metadata: {
            esigId: result?.id,
            userId: result?.userId,
            docType: result?.docType,
            status: result?.status,
          }
        };
      }
    },
    updateEsig: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.userId || beforeState?.esig?.userId;
      },
      getDescription: async (args, result, beforeState) => {
        const oldStatus = beforeState?.esig?.status;
        const newStatus = result?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          return `Updated e-signature: ${oldStatus} → ${newStatus}`;
        }
        return `Updated e-signature`;
      },
      before: async (args, storage) => {
        const esig = await storage.getEsigById(args[0]);
        return { esig };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          esig: result,
          previousState: beforeState?.esig,
          metadata: {
            esigId: result?.id,
            userId: result?.userId,
            docType: result?.docType,
            status: result?.status,
            previousStatus: beforeState?.esig?.status,
          }
        };
      }
    },
  },
};
