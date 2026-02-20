import { getClient } from './transaction-context';
import { cardchecks, cardcheckDefinitions, workers, contacts, bargainingUnits, employers, esigs, workerHours, optionsEmploymentStatus, type Cardcheck, type InsertCardcheck, type Esig, type InsertEsig, type File } from "@shared/schema";
import { eq, and, gte, lte, sql, isNull, isNotNull, inArray, count } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";
import { 
  type ValidationError,
  createAsyncStorageValidator
} from "./utils/validation";
import crypto from "crypto";

export const cardcheckValidate = createAsyncStorageValidator<InsertCardcheck, Cardcheck, {}>(
  async (data, existing) => {
    const errors: ValidationError[] = [];
    const client = getClient();
    
    const status = data.status !== undefined ? data.status : existing?.status;
    const workerId = data.workerId ?? existing?.workerId;
    const cardcheckDefinitionId = data.cardcheckDefinitionId ?? existing?.cardcheckDefinitionId;
    
    if (status === "signed" && workerId && cardcheckDefinitionId) {
      const wasAlreadySigned = existing?.status === "signed";
      
      if (!wasAlreadySigned) {
        const existingSigned = await client
          .select()
          .from(cardchecks)
          .where(and(
            eq(cardchecks.workerId, workerId),
            eq(cardchecks.cardcheckDefinitionId, cardcheckDefinitionId),
            eq(cardchecks.status, "signed")
          ));
        
        if (existingSigned.length > 0) {
          errors.push({
            field: 'status',
            code: 'DUPLICATE_SIGNED',
            message: "A signed cardcheck of this type already exists for this worker"
          });
        }
      }
    }
    
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, value: {} };
  }
);

export interface CardcheckStatusSummary {
  workerId: string;
  definitionId: string;
  definitionName: string;
  definitionIcon: string;
  status: 'signed' | 'pending' | 'revoked' | 'none';
}

export interface SignedCardcheckWithDetails {
  cardcheckId: string;
  workerId: string;
  workerSiriusId: number;
  workerName: string;
  bargainingUnitId: string | null;
  bargainingUnitName: string | null;
  employerNames: string[];
  rate: number | null;
  signedDate: Date | null;
}

export interface CardcheckReportFilters {
  signedDateFrom?: string;
  signedDateTo?: string;
  hasPreviousCardcheck?: boolean;
  status?: 'pending' | 'signed' | 'revoked';
  bargainingUnitId?: string;
  definitionId?: string;
}

export interface CardcheckReportItem {
  cardcheckId: string;
  workerId: string;
  workerSiriusId: number;
  workerName: string;
  bargainingUnitId: string | null;
  bargainingUnitName: string | null;
  status: 'pending' | 'signed' | 'revoked';
  signedDate: Date | null;
  hasPreviousCardcheck: boolean;
  previousCardcheckCount: number;
  definitionId: string;
  definitionName: string;
  buChanged: boolean;
  previousBargainingUnitName: string | null;
  terminatedOver30Days: boolean;
}

export interface SignCardcheckParams {
  cardcheckId: string;
  userId: string;
  docRender: string;
  docType: string;
  esigData: any;
  signatureType: string;
  fileId?: string;
  rate?: number;
}

export interface SignCardcheckResult {
  esig: Esig;
  cardcheck: Cardcheck;
}

export interface CardcheckStorageDependencies {
  getFileById: (id: string) => Promise<File | undefined>;
  updateFile: (id: string, updates: Partial<{ entityType: string; entityId: string }>) => Promise<File | undefined>;
  createEsig: (data: InsertEsig) => Promise<Esig>;
}

export interface CardcheckStorage {
  getAllCardchecks(): Promise<Cardcheck[]>;
  getCardcheckById(id: string): Promise<Cardcheck | undefined>;
  getCardcheckByEsigId(esigId: string): Promise<Cardcheck | undefined>;
  getCardchecksByWorkerId(workerId: string): Promise<Cardcheck[]>;
  getCardchecksByDefinitionId(definitionId: string): Promise<Cardcheck[]>;
  getCardcheckBySourceNid(sourceNid: string): Promise<Cardcheck | undefined>;
  getCardchecksBySourceNids(sourceNids: string[]): Promise<Cardcheck[]>;
  getCardchecksWithSourceNidMissingEsig(cardcheckDefinitionId?: string): Promise<Cardcheck[]>;
  getCardcheckStatusSummary(): Promise<CardcheckStatusSummary[]>;
  getAllSignedCardchecksWithDetails(): Promise<SignedCardcheckWithDetails[]>;
  getCardcheckReport(filters: CardcheckReportFilters): Promise<CardcheckReportItem[]>;
  createCardcheck(data: InsertCardcheck): Promise<Cardcheck>;
  updateCardcheck(id: string, data: Partial<InsertCardcheck>): Promise<Cardcheck | undefined>;
  deleteCardcheck(id: string): Promise<boolean>;
  signCardcheck(params: SignCardcheckParams): Promise<SignCardcheckResult>;
}

let storedDeps: CardcheckStorageDependencies | null = null;

export function setCardcheckStorageDeps(deps: CardcheckStorageDependencies) {
  storedDeps = deps;
}

export function createCardcheckStorage(): CardcheckStorage {
  const storage: CardcheckStorage = {
    async getAllCardchecks(): Promise<Cardcheck[]> {
      const client = getClient();
      return await client.select().from(cardchecks);
    },

    async getCardcheckById(id: string): Promise<Cardcheck | undefined> {
      const client = getClient();
      const [cardcheck] = await client
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.id, id));
      return cardcheck || undefined;
    },

    async getCardcheckByEsigId(esigId: string): Promise<Cardcheck | undefined> {
      const client = getClient();
      const [cardcheck] = await client
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.esigId, esigId));
      return cardcheck || undefined;
    },

    async getCardchecksByWorkerId(workerId: string): Promise<Cardcheck[]> {
      const client = getClient();
      return await client
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.workerId, workerId));
    },

    async getCardchecksByDefinitionId(definitionId: string): Promise<Cardcheck[]> {
      const client = getClient();
      return await client
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.cardcheckDefinitionId, definitionId));
    },

    async getCardcheckBySourceNid(sourceNid: string): Promise<Cardcheck | undefined> {
      const client = getClient();
      const [cardcheck] = await client
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.sourceNid, sourceNid));
      return cardcheck || undefined;
    },

    async getCardchecksBySourceNids(sourceNids: string[]): Promise<Cardcheck[]> {
      if (sourceNids.length === 0) return [];
      const client = getClient();
      return await client
        .select()
        .from(cardchecks)
        .where(inArray(cardchecks.sourceNid, sourceNids));
    },

    async getCardchecksWithSourceNidMissingEsig(cardcheckDefinitionId?: string): Promise<Cardcheck[]> {
      const client = getClient();
      const conditions = [
        isNotNull(cardchecks.sourceNid),
        isNull(cardchecks.esigId),
      ];
      if (cardcheckDefinitionId) {
        conditions.push(eq(cardchecks.cardcheckDefinitionId, cardcheckDefinitionId));
      }
      return await client
        .select()
        .from(cardchecks)
        .where(and(...conditions));
    },

    async getCardcheckStatusSummary(): Promise<CardcheckStatusSummary[]> {
      const client = getClient();
      const definitions = await client.select().from(cardcheckDefinitions);
      const definitionsWithIcons = definitions.filter(d => {
        const data = d.data as any;
        return data?.icon;
      });
      
      if (definitionsWithIcons.length === 0) {
        return [];
      }
      
      const allWorkers = await client.select({ id: workers.id }).from(workers);
      const allCardchecks = await client.select().from(cardchecks);
      
      const cardcheckMap = new Map<string, Map<string, string>>();
      for (const cc of allCardchecks) {
        if (!cardcheckMap.has(cc.workerId)) {
          cardcheckMap.set(cc.workerId, new Map());
        }
        const workerMap = cardcheckMap.get(cc.workerId)!;
        const existingStatus = workerMap.get(cc.cardcheckDefinitionId);
        if (!existingStatus || cc.status === 'signed' || (cc.status === 'revoked' && existingStatus !== 'signed')) {
          workerMap.set(cc.cardcheckDefinitionId, cc.status);
        }
      }
      
      const summaries: CardcheckStatusSummary[] = [];
      for (const worker of allWorkers) {
        for (const def of definitionsWithIcons) {
          const workerCardchecks = cardcheckMap.get(worker.id);
          const status = workerCardchecks?.get(def.id) || 'none';
          summaries.push({
            workerId: worker.id,
            definitionId: def.id,
            definitionName: def.name,
            definitionIcon: (def.data as any).icon,
            status: status as 'signed' | 'pending' | 'revoked' | 'none',
          });
        }
      }
      
      return summaries;
    },

    async getAllSignedCardchecksWithDetails(): Promise<SignedCardcheckWithDetails[]> {
      const client = getClient();
      const signedCards = await client
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.status, "signed"));
      
      if (signedCards.length === 0) return [];
      
      const workersData = await client
        .select({
          id: workers.id,
          siriusId: workers.siriusId,
          contactId: workers.contactId,
          bargainingUnitId: workers.bargainingUnitId,
          denormEmployerIds: workers.denormEmployerIds,
        })
        .from(workers);
      
      const workerMap = new Map(workersData.map(w => [w.id, w]));
      
      const contactsData = await client
        .select({
          id: contacts.id,
          given: contacts.given,
          family: contacts.family,
          displayName: contacts.displayName,
        })
        .from(contacts);
      
      const contactMap = new Map(contactsData.map(c => [c.id, c]));
      
      const buData = await client
        .select({
          id: bargainingUnits.id,
          name: bargainingUnits.name,
        })
        .from(bargainingUnits);
      
      const buMap = new Map(buData.map(b => [b.id, b.name]));
      
      const employerData = await client
        .select({
          id: employers.id,
          name: employers.name,
        })
        .from(employers);
      
      const employerMap = new Map(employerData.map(e => [e.id, e.name]));
      
      const results: SignedCardcheckWithDetails[] = [];
      
      for (const card of signedCards) {
        const worker = workerMap.get(card.workerId);
        if (!worker) continue;
        
        const contact = contactMap.get(worker.contactId);
        const workerName = contact 
          ? `${contact.family || ''}, ${contact.given || ''}`.trim().replace(/^,\s*|,\s*$/g, '') || contact.displayName || `Worker #${worker.siriusId}`
          : `Worker #${worker.siriusId}`;
        
        const employerNames: string[] = [];
        if (worker.denormEmployerIds) {
          for (const empId of worker.denormEmployerIds) {
            const name = employerMap.get(empId);
            if (name) employerNames.push(name);
          }
        }
        
        results.push({
          cardcheckId: card.id,
          workerId: card.workerId,
          workerSiriusId: worker.siriusId,
          workerName,
          bargainingUnitId: worker.bargainingUnitId,
          bargainingUnitName: worker.bargainingUnitId ? buMap.get(worker.bargainingUnitId) || null : null,
          employerNames,
          rate: card.rate,
          signedDate: card.signedDate,
        });
      }
      
      return results;
    },

    async getCardcheckReport(filters: CardcheckReportFilters): Promise<CardcheckReportItem[]> {
      const client = getClient();
      
      const conditions: any[] = [];
      
      if (filters.status) {
        conditions.push(eq(cardchecks.status, filters.status));
      }
      
      if (filters.definitionId) {
        conditions.push(eq(cardchecks.cardcheckDefinitionId, filters.definitionId));
      }
      
      if (filters.signedDateFrom) {
        conditions.push(gte(cardchecks.signedDate, new Date(filters.signedDateFrom)));
      }
      
      if (filters.signedDateTo) {
        const endDate = new Date(filters.signedDateTo);
        endDate.setHours(23, 59, 59, 999);
        conditions.push(lte(cardchecks.signedDate, endDate));
      }
      
      const allCardchecks = conditions.length > 0
        ? await client.select().from(cardchecks).where(and(...conditions))
        : await client.select().from(cardchecks);
      
      if (allCardchecks.length === 0) return [];
      
      const workerIds = Array.from(new Set(allCardchecks.map(c => c.workerId)));
      const workersData = await client
        .select({
          id: workers.id,
          siriusId: workers.siriusId,
          contactId: workers.contactId,
          bargainingUnitId: workers.bargainingUnitId,
        })
        .from(workers)
        .where(inArray(workers.id, workerIds));
      
      const workerMap = new Map(workersData.map(w => [w.id, w]));
      
      const contactIds = workersData.map(w => w.contactId).filter(Boolean);
      const contactsData = contactIds.length > 0
        ? await client
            .select({
              id: contacts.id,
              given: contacts.given,
              family: contacts.family,
              displayName: contacts.displayName,
            })
            .from(contacts)
            .where(inArray(contacts.id, contactIds))
        : [];
      
      const contactMap = new Map(contactsData.map(c => [c.id, c]));
      
      const buData = await client
        .select({
          id: bargainingUnits.id,
          name: bargainingUnits.name,
        })
        .from(bargainingUnits);
      
      const buMap = new Map(buData.map(b => [b.id, b.name]));
      
      const defData = await client
        .select({
          id: cardcheckDefinitions.id,
          name: cardcheckDefinitions.name,
        })
        .from(cardcheckDefinitions);
      
      const defMap = new Map(defData.map(d => [d.id, d.name]));
      
      const previousCountsQuery = await client
        .select({
          workerId: cardchecks.workerId,
          count: count(),
        })
        .from(cardchecks)
        .where(inArray(cardchecks.workerId, workerIds))
        .groupBy(cardchecks.workerId);
      
      const cardcheckCountMap = new Map(previousCountsQuery.map(r => [r.workerId, Number(r.count)]));

      const allWorkerCardchecks = await client
        .select({
          id: cardchecks.id,
          workerId: cardchecks.workerId,
          bargainingUnitId: cardchecks.bargainingUnitId,
          signedDate: cardchecks.signedDate,
        })
        .from(cardchecks)
        .where(inArray(cardchecks.workerId, workerIds));

      const workerCardchecksMap = new Map<string, typeof allWorkerCardchecks>();
      for (const cc of allWorkerCardchecks) {
        if (!workerCardchecksMap.has(cc.workerId)) {
          workerCardchecksMap.set(cc.workerId, []);
        }
        workerCardchecksMap.get(cc.workerId)!.push(cc);
      }
      workerCardchecksMap.forEach((ccs) => {
        ccs.sort((a: any, b: any) => {
          const dateA = a.signedDate ? new Date(a.signedDate).getTime() : 0;
          const dateB = b.signedDate ? new Date(b.signedDate).getTime() : 0;
          if (dateA !== dateB) return dateA - dateB;
          return a.id.localeCompare(b.id);
        });
      });

      const allEmploymentRecords = workerIds.length > 0
        ? await client.execute(sql`
            SELECT
              wh.worker_id as "workerId",
              wh.year,
              wh.month,
              wh.day,
              es.employed
            FROM worker_hours wh
            JOIN options_employment_status es ON es.id = wh.employment_status_id
            WHERE wh.worker_id IN (${sql.join(workerIds.map(id => sql`${id}`), sql`, `)})
            ORDER BY wh.worker_id, wh.year DESC, wh.month DESC, wh.day DESC
          `)
        : { rows: [] as any[] };

      const workerEmploymentMap = new Map<string, { date: Date; employed: boolean }[]>();
      for (const rec of allEmploymentRecords.rows as any[]) {
        const wid = rec.workerId as string;
        if (!workerEmploymentMap.has(wid)) {
          workerEmploymentMap.set(wid, []);
        }
        workerEmploymentMap.get(wid)!.push({
          date: new Date(Number(rec.year), Number(rec.month) - 1, Number(rec.day)),
          employed: Boolean(rec.employed),
        });
      }

      const results: CardcheckReportItem[] = [];
      
      for (const card of allCardchecks) {
        const worker = workerMap.get(card.workerId);
        if (!worker) continue;
        
        if (filters.bargainingUnitId && worker.bargainingUnitId !== filters.bargainingUnitId) {
          continue;
        }
        
        const totalCardchecks = cardcheckCountMap.get(card.workerId) || 0;
        const hasPrevious = totalCardchecks > 1;
        
        if (filters.hasPreviousCardcheck !== undefined && hasPrevious !== filters.hasPreviousCardcheck) {
          continue;
        }
        
        const contact = contactMap.get(worker.contactId);
        const workerName = contact 
          ? `${contact.family || ''}, ${contact.given || ''}`.trim().replace(/^,\s*|,\s*$/g, '') || contact.displayName || `Worker #${worker.siriusId}`
          : `Worker #${worker.siriusId}`;

        let buChanged = false;
        let previousBargainingUnitName: string | null = null;
        if (hasPrevious) {
          const workerCcs = workerCardchecksMap.get(card.workerId) || [];
          const thisIndex = workerCcs.findIndex(cc => cc.id === card.id);
          if (thisIndex > 0) {
            const prevCc = workerCcs[thisIndex - 1];
            const prevBuId = prevCc.bargainingUnitId;
            const currentBuId = card.bargainingUnitId;
            if (prevBuId !== currentBuId) {
              buChanged = true;
              previousBargainingUnitName = prevBuId ? buMap.get(prevBuId) || null : null;
            }
          }
        }

        let terminatedOver30Days = false;
        if (hasPrevious && card.signedDate) {
          const empRecords = workerEmploymentMap.get(card.workerId);
          if (empRecords) {
            const signedTime = new Date(card.signedDate).getTime();
            const priorRecord = empRecords.find(r => r.date.getTime() <= signedTime);
            if (priorRecord && !priorRecord.employed) {
              const diffDays = (signedTime - priorRecord.date.getTime()) / (1000 * 60 * 60 * 24);
              if (diffDays >= 30) {
                terminatedOver30Days = true;
              }
            }
          }
        }

        results.push({
          cardcheckId: card.id,
          workerId: card.workerId,
          workerSiriusId: worker.siriusId,
          workerName,
          bargainingUnitId: worker.bargainingUnitId,
          bargainingUnitName: worker.bargainingUnitId ? buMap.get(worker.bargainingUnitId) || null : null,
          status: card.status,
          signedDate: card.signedDate,
          hasPreviousCardcheck: hasPrevious,
          previousCardcheckCount: totalCardchecks - 1,
          definitionId: card.cardcheckDefinitionId,
          definitionName: defMap.get(card.cardcheckDefinitionId) || 'Unknown',
          buChanged,
          previousBargainingUnitName,
          terminatedOver30Days,
        });
      }
      
      return results;
    },

    async createCardcheck(data: InsertCardcheck): Promise<Cardcheck> {
      const client = getClient();
      await cardcheckValidate.validateOrThrow(data);
      
      const [cardcheck] = await client
        .insert(cardchecks)
        .values(data)
        .returning();
      return cardcheck;
    },

    async updateCardcheck(id: string, data: Partial<InsertCardcheck>): Promise<Cardcheck | undefined> {
      const client = getClient();
      const current = await storage.getCardcheckById(id);
      if (!current) {
        return undefined;
      }
      
      await cardcheckValidate.validateOrThrow(data, current);
      
      const [updated] = await client
        .update(cardchecks)
        .set(data)
        .where(eq(cardchecks.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteCardcheck(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(cardchecks)
        .where(eq(cardchecks.id, id))
        .returning();
      return result.length > 0;
    },

    async signCardcheck(params: SignCardcheckParams): Promise<SignCardcheckResult> {
      if (!storedDeps) {
        throw new Error("Cardcheck storage dependencies not initialized. Call setCardcheckStorageDeps first.");
      }
      const deps = storedDeps;
      const client = getClient();
      const { cardcheckId, userId, docRender, docType, esigData, signatureType, fileId, rate } = params;
      const docHash = crypto.createHash("sha256").update(docRender).digest("hex");

      if (fileId && signatureType === "upload") {
        const file = await deps.getFileById(fileId);
        if (!file) {
          throw new Error("Referenced file not found");
        }
        if (file.uploadedBy !== userId) {
          throw new Error("You are not authorized to sign with this file");
        }
      }

      const newEsig = await deps.createEsig({
        userId,
        status: "signed",
        signedDate: new Date(),
        type: signatureType === "upload" ? "upload" : "online",
        docRender,
        docHash,
        esig: esigData,
        docType,
      });

      if (fileId && signatureType === "upload") {
        await deps.updateFile(fileId, {
          entityType: "esig",
          entityId: newEsig.id,
        });
      }

      const updatedCardcheck = await storage.updateCardcheck(cardcheckId, {
        status: "signed",
        signedDate: new Date(),
        esigId: newEsig.id,
        rate: rate,
      });

      if (!updatedCardcheck) {
        throw new Error("Failed to update cardcheck");
      }

      return { esig: newEsig, cardcheck: updatedCardcheck };
    },
  };

  return storage;
}

async function getWorkerName(workerId: string): Promise<string> {
  const client = getClient();
  const [worker] = await client
    .select({ contactId: workers.contactId, siriusId: workers.siriusId })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) return 'Unknown Worker';
  
  const [contact] = await client
    .select({ given: contacts.given, family: contacts.family, displayName: contacts.displayName })
    .from(contacts)
    .where(eq(contacts.id, worker.contactId));
  
  const name = contact ? `${contact.given || ''} ${contact.family || ''}`.trim() : '';
  return name || contact?.displayName || `Worker #${worker.siriusId}`;
}

async function getDefinitionName(definitionId: string): Promise<string> {
  const client = getClient();
  const [definition] = await client
    .select({ name: cardcheckDefinitions.name, siriusId: cardcheckDefinitions.siriusId })
    .from(cardcheckDefinitions)
    .where(eq(cardcheckDefinitions.id, definitionId));
  return definition ? `[${definition.siriusId}] ${definition.name}` : 'Unknown Definition';
}

export const cardcheckLoggingConfig: StorageLoggingConfig<CardcheckStorage> = {
  module: 'cardchecks',
  methods: {
    createCardcheck: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new cardcheck',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const definitionName = await getDefinitionName(result?.cardcheckDefinitionId || args[0]?.cardcheckDefinitionId);
        return `Created Cardcheck for ${workerName} - ${definitionName}`;
      },
      after: async (args, result) => {
        return {
          cardcheck: result,
          metadata: {
            cardcheckId: result?.id,
            workerId: result?.workerId,
            cardcheckDefinitionId: result?.cardcheckDefinitionId,
            status: result?.status,
          }
        };
      }
    },
    updateCardcheck: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.cardcheck?.workerId) {
          return beforeState.cardcheck.workerId;
        }
        const client = getClient();
        const [cardcheck] = await client.select().from(cardchecks).where(eq(cardchecks.id, args[0]));
        return cardcheck?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerId = result?.workerId || beforeState?.cardcheck?.workerId;
        const workerName = workerId ? await getWorkerName(workerId) : 'Unknown Worker';
        const definitionId = result?.cardcheckDefinitionId || beforeState?.cardcheck?.cardcheckDefinitionId;
        const definitionName = definitionId ? await getDefinitionName(definitionId) : 'Unknown Definition';
        
        const oldStatus = beforeState?.cardcheck?.status;
        const newStatus = result?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          return `Updated Cardcheck for ${workerName} - ${definitionName}: ${oldStatus} → ${newStatus}`;
        }
        return `Updated Cardcheck for ${workerName} - ${definitionName}`;
      },
      before: async (args, storage) => {
        const cardcheck = await storage.getCardcheckById(args[0]);
        return { cardcheck };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          cardcheck: result,
          previousState: beforeState?.cardcheck,
          metadata: {
            cardcheckId: result?.id,
            workerId: result?.workerId,
            cardcheckDefinitionId: result?.cardcheckDefinitionId,
            status: result?.status,
            previousStatus: beforeState?.cardcheck?.status,
          }
        };
      }
    },
    deleteCardcheck: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.cardcheck?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerId = beforeState?.cardcheck?.workerId;
        const workerName = workerId ? await getWorkerName(workerId) : 'Unknown Worker';
        const definitionId = beforeState?.cardcheck?.cardcheckDefinitionId;
        const definitionName = definitionId ? await getDefinitionName(definitionId) : 'Unknown Definition';
        return `Deleted Cardcheck for ${workerName} - ${definitionName}`;
      },
      before: async (args, storage) => {
        const cardcheck = await storage.getCardcheckById(args[0]);
        return { cardcheck };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deleted: result,
          cardcheck: beforeState?.cardcheck,
          metadata: {
            cardcheckId: args[0],
            workerId: beforeState?.cardcheck?.workerId,
            cardcheckDefinitionId: beforeState?.cardcheck?.cardcheckDefinitionId,
            status: beforeState?.cardcheck?.status,
          }
        };
      }
    },
    signCardcheck: {
      enabled: true,
      getEntityId: (args, result) => result?.cardcheck?.id || args[0]?.cardcheckId,
      getHostEntityId: async (args, result) => {
        if (result?.cardcheck?.workerId) {
          return result.cardcheck.workerId;
        }
        return undefined;
      },
      getDescription: async (args, result) => {
        const workerId = result?.cardcheck?.workerId;
        const definitionId = result?.cardcheck?.cardcheckDefinitionId;
        if (!workerId || !definitionId) return 'Signed Cardcheck';
        const workerName = await getWorkerName(workerId);
        const definitionName = await getDefinitionName(definitionId);
        return `Signed Cardcheck for ${workerName} - ${definitionName}`;
      },
      after: async (args, result) => {
        return {
          cardcheck: result?.cardcheck,
          esig: result?.esig,
          metadata: {
            cardcheckId: result?.cardcheck?.id,
            esigId: result?.esig?.id,
            workerId: result?.cardcheck?.workerId,
            cardcheckDefinitionId: result?.cardcheck?.cardcheckDefinitionId,
            status: result?.cardcheck?.status,
            rate: result?.cardcheck?.rate,
          }
        };
      }
    },
  },
};
