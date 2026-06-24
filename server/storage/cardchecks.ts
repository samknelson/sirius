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
  cardBargainingUnitId: string | null;
  cardBargainingUnitName: string | null;
  buMismatch: boolean;
  currentlyTerminated30Days: boolean;
  currentTerminationDate: string | null;
  signatureType: 'online' | 'upload' | 'offline' | null;
  rate: number | null;
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

export interface OrganizingEmployerRow {
  id: string;
  name: string;
  typeId: string | null;
  typeName: string | null;
  typeIcon: string | null;
  schoolTypeIds: string[] | null;
  regionId: string | null;
  regionName: string | null;
  gradeStart: number | null;
  gradeEnd: number | null;
}

export interface OrganizingSchoolType {
  id: string;
  name: string;
  icon: string | null;
}

export interface OrganizingEmployerStat {
  employerId: string;
  bargainingUnitId: string | null;
  bargainingUnitName: string | null;
  totalWorkers: number;
  signedWorkers: number;
}

export interface OrganizingSecondaryGroupWorker {
  workerId: string;
  employerId: string;
  employerName: string;
  displayName: string;
  statusName: string;
  statusDate: Date | string | null;
}

export interface OrganizingSteward {
  employerId: string;
  workerId: string;
  bargainingUnitId: string | null;
  bargainingUnitName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface OrganizingPrincipal {
  employerId: string;
  contactId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface OrganizingDistinctStat {
  bargainingUnitId: string | null;
  totalDistinctWorkers: number;
  signedDistinctWorkers: number;
}

export interface OrganizingNewMember {
  workerId: string;
  displayName: string;
  signedDate: Date | string | null;
  bargainingUnitName: string | null;
  bargainingUnitId: string | null;
  employerName: string;
  employerId: string | null;
}

export interface MissingCardcheckWorkerRow {
  workerId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  bargainingUnitId: string | null;
  bargainingUnitName: string | null;
  invalidReason: string | null;
  employmentStatus: string | null;
}

export interface CardcheckStorage {
  getAllCardchecks(): Promise<Cardcheck[]>;
  getCardcheckById(id: string): Promise<Cardcheck | undefined>;
  getCardcheckByEsigId(esigId: string): Promise<Cardcheck | undefined>;
  getCardchecksByWorkerId(workerId: string): Promise<Cardcheck[]>;
  getCardchecksByDefinitionId(definitionId: string): Promise<Cardcheck[]>;
  getCardcheckByExternalId(externalId: string): Promise<Cardcheck | undefined>;
  getCardchecksByExternalIds(externalIds: string[]): Promise<Cardcheck[]>;
  getCardchecksWithExternalIdMissingEsig(cardcheckDefinitionId?: string): Promise<Cardcheck[]>;
  getCardcheckStatusSummary(): Promise<CardcheckStatusSummary[]>;
  getAllSignedCardchecksWithDetails(): Promise<SignedCardcheckWithDetails[]>;
  getCardcheckReport(filters: CardcheckReportFilters): Promise<CardcheckReportItem[]>;
  createCardcheck(data: InsertCardcheck): Promise<Cardcheck>;
  updateCardcheck(id: string, data: Partial<InsertCardcheck>): Promise<Cardcheck | undefined>;
  deleteCardcheck(id: string): Promise<boolean>;
  signCardcheck(params: SignCardcheckParams): Promise<SignCardcheckResult>;
  getOrganizingEmployerList(): Promise<OrganizingEmployerRow[]>;
  getOrganizingSchoolTypes(): Promise<OrganizingSchoolType[]>;
  getOrganizingEmployerStats(primaryStatusIds: string[]): Promise<OrganizingEmployerStat[]>;
  getOrganizingSecondaryGroupWorkers(statusIds: string[]): Promise<OrganizingSecondaryGroupWorker[]>;
  getOrganizingStewards(): Promise<OrganizingSteward[]>;
  getOrganizingPrincipals(): Promise<OrganizingPrincipal[]>;
  getOrganizingDistinctStats(primaryStatusIds: string[]): Promise<OrganizingDistinctStat[]>;
  getOrganizingNewMembers(days: number): Promise<OrganizingNewMember[]>;
  getMissingCardchecksForEmployer(employerId: string, primaryStatusIds: string[]): Promise<MissingCardcheckWorkerRow[]>;
  hasSignedCardcheckOfDefinition(workerId: string, cardcheckDefinitionId: string): Promise<boolean>;
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

    async getCardcheckByExternalId(externalId: string): Promise<Cardcheck | undefined> {
      const client = getClient();
      const [cardcheck] = await client
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.externalId, externalId));
      return cardcheck || undefined;
    },

    async getCardchecksByExternalIds(externalIds: string[]): Promise<Cardcheck[]> {
      if (externalIds.length === 0) return [];
      const client = getClient();
      return await client
        .select()
        .from(cardchecks)
        .where(inArray(cardchecks.externalId, externalIds));
    },

    async getCardchecksWithExternalIdMissingEsig(cardcheckDefinitionId?: string): Promise<Cardcheck[]> {
      const client = getClient();
      const conditions = [
        isNotNull(cardchecks.externalId),
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
          denormEmployerIds: sql<string[] | null>`(SELECT array_agg(wed.employer_id) FROM worker_employment_denorm wed WHERE wed.worker_id = ${workers.id})`,
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

      const esigIds = allCardchecks.map(c => c.esigId).filter(Boolean) as string[];
      const esigTypeMap = new Map<string, 'online' | 'upload' | 'offline'>();
      if (esigIds.length > 0) {
        const esigData = await client
          .select({
            id: esigs.id,
            type: esigs.type,
          })
          .from(esigs)
          .where(inArray(esigs.id, esigIds));
        for (const e of esigData) {
          esigTypeMap.set(e.id, e.type);
        }
      }

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

        const cardBuId = card.bargainingUnitId || null;
        const workerBuId = worker.bargainingUnitId || null;
        const buMismatch = cardBuId !== workerBuId;

        let currentlyTerminated30Days = false;
        let currentTerminationDate: string | null = null;
        {
          const empRecords = workerEmploymentMap.get(card.workerId);
          if (empRecords && empRecords.length > 0) {
            const latestRecord = empRecords[0];
            if (!latestRecord.employed) {
              const nowMs = Date.now();
              const diffDays = (nowMs - latestRecord.date.getTime()) / (1000 * 60 * 60 * 24);
              if (diffDays >= 30) {
                currentlyTerminated30Days = true;
                currentTerminationDate = latestRecord.date.toISOString().split('T')[0];
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
          cardBargainingUnitId: card.bargainingUnitId || null,
          cardBargainingUnitName: card.bargainingUnitId ? buMap.get(card.bargainingUnitId) || null : null,
          buMismatch,
          currentlyTerminated30Days,
          currentTerminationDate,
          signatureType: card.esigId ? esigTypeMap.get(card.esigId) || null : null,
          rate: card.rate ?? null,
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

    async hasSignedCardcheckOfDefinition(workerId: string, cardcheckDefinitionId: string): Promise<boolean> {
      const client = getClient();
      const [row] = await client
        .select({ id: cardchecks.id })
        .from(cardchecks)
        .where(and(
          eq(cardchecks.workerId, workerId),
          eq(cardchecks.cardcheckDefinitionId, cardcheckDefinitionId),
          eq(cardchecks.status, "signed"),
        ))
        .limit(1);
      return !!row;
    },

    async getOrganizingEmployerList(): Promise<OrganizingEmployerRow[]> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT
          e.id,
          e.name,
          e.type_id as "typeId",
          et.name as "typeName",
          et.data->>'icon' as "typeIcon",
          sa.school_type_ids as "schoolTypeIds",
          sa.region_id as "regionId",
          r.name as "regionName",
          sa.grade_start as "gradeStart",
          sa.grade_end as "gradeEnd"
        FROM employers e
        LEFT JOIN options_employer_type et ON e.type_id = et.id
        LEFT JOIN sitespecific_btu_school_attributes sa ON sa.employer_id = e.id
        LEFT JOIN sitespecific_btu_regions r ON r.id = sa.region_id
        WHERE e.is_active = true
        ORDER BY e.name
      `);
      return result.rows as unknown as OrganizingEmployerRow[];
    },

    async getOrganizingSchoolTypes(): Promise<OrganizingSchoolType[]> {
      const client = getClient();
      try {
        const result = await client.execute(sql`
          SELECT id, name, data->>'icon' as icon
          FROM sitespecific_btu_school_types
        `);
        return (result.rows as any[]).map(row => ({
          id: row.id,
          name: row.name,
          icon: row.icon || null,
        }));
      } catch {
        return [];
      }
    },

    async getOrganizingEmployerStats(primaryStatusIds: string[]): Promise<OrganizingEmployerStat[]> {
      const client = getClient();
      const hasPrimaryFilter = primaryStatusIds.length > 0;
      const result = await client.execute(sql`
        WITH latest_employment AS (
          SELECT DISTINCT ON (wh.worker_id, wh.employer_id)
            wh.worker_id,
            wh.employer_id,
            wh.employment_status_id,
            es.name as status_name,
            es.employed as is_employed
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          ORDER BY wh.worker_id, wh.employer_id, wh.year DESC, wh.month DESC, wh.day DESC
        ),
        active_workers AS (
          SELECT
            le.worker_id,
            le.employer_id,
            w.bargaining_unit_id
          FROM latest_employment le
          INNER JOIN workers w ON w.id = le.worker_id
          WHERE ${hasPrimaryFilter
            ? sql`le.employment_status_id IN (${sql.join(primaryStatusIds.map(id => sql`${id}`), sql`, `)})`
            : sql`le.is_employed = true`}
        ),
        worker_cardchecks AS (
          SELECT
            aw.employer_id,
            aw.bargaining_unit_id,
            COUNT(DISTINCT aw.worker_id) as total_workers,
            COUNT(DISTINCT CASE WHEN cc.status = 'signed' THEN aw.worker_id END) as signed_workers
          FROM active_workers aw
          LEFT JOIN cardchecks cc ON cc.worker_id = aw.worker_id AND cc.status = 'signed'
          GROUP BY aw.employer_id, aw.bargaining_unit_id
        )
        SELECT
          wc.employer_id as "employerId",
          wc.bargaining_unit_id as "bargainingUnitId",
          bu.name as "bargainingUnitName",
          wc.total_workers as "totalWorkers",
          wc.signed_workers as "signedWorkers"
        FROM worker_cardchecks wc
        LEFT JOIN bargaining_units bu ON bu.id = wc.bargaining_unit_id
      `);
      return (result.rows as any[]).map(row => ({
        employerId: row.employerId,
        bargainingUnitId: row.bargainingUnitId,
        bargainingUnitName: row.bargainingUnitName,
        totalWorkers: Number(row.totalWorkers) || 0,
        signedWorkers: Number(row.signedWorkers) || 0,
      }));
    },

    async getOrganizingSecondaryGroupWorkers(statusIds: string[]): Promise<OrganizingSecondaryGroupWorker[]> {
      if (statusIds.length === 0) return [];
      const client = getClient();
      const result = await client.execute(sql`
        WITH latest_employment AS (
          SELECT DISTINCT ON (wh.worker_id, wh.employer_id)
            wh.worker_id,
            wh.employer_id,
            wh.employment_status_id,
            es.name as status_name,
            make_date(wh.year, wh.month, wh.day) as status_date
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          ORDER BY wh.worker_id, wh.employer_id, wh.year DESC, wh.month DESC, wh.day DESC
        )
        SELECT
          le.worker_id as "workerId",
          le.employer_id as "employerId",
          e.name as "employerName",
          c.display_name as "displayName",
          le.status_name as "statusName",
          le.status_date as "statusDate"
        FROM latest_employment le
        INNER JOIN workers w ON w.id = le.worker_id
        INNER JOIN contacts c ON c.id = w.contact_id
        INNER JOIN employers e ON e.id = le.employer_id
        WHERE le.employment_status_id IN (${sql.join(statusIds.map(id => sql`${id}`), sql`, `)})
          AND e.is_active = true
        ORDER BY e.name, c.display_name
      `);
      return result.rows as unknown as OrganizingSecondaryGroupWorker[];
    },

    async getOrganizingStewards(): Promise<OrganizingSteward[]> {
      const client = getClient();
      try {
        const result = await client.execute(sql`
          SELECT
            wsa.employer_id as "employerId",
            wsa.worker_id as "workerId",
            wsa.bargaining_unit_id as "bargainingUnitId",
            c.display_name as "displayName",
            c.email,
            bu.name as "bargainingUnitName",
            (
              SELECT cp.phone_number
              FROM contact_phone cp
              WHERE cp.contact_id = c.id AND cp.is_active = true
              ORDER BY cp.is_primary DESC NULLS LAST
              LIMIT 1
            ) as "phone"
          FROM worker_steward_assignments wsa
          INNER JOIN workers w ON w.id = wsa.worker_id
          INNER JOIN contacts c ON c.id = w.contact_id
          LEFT JOIN bargaining_units bu ON bu.id = wsa.bargaining_unit_id
          ORDER BY c.display_name
        `);
        return result.rows as unknown as OrganizingSteward[];
      } catch {
        return [];
      }
    },

    async getOrganizingPrincipals(): Promise<OrganizingPrincipal[]> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT
          ec.employer_id as "employerId",
          c.id as "contactId",
          c.display_name as "displayName",
          c.email,
          (
            SELECT cp.phone_number
            FROM contact_phone cp
            WHERE cp.contact_id = c.id AND cp.is_active = true
            ORDER BY cp.is_primary DESC NULLS LAST
            LIMIT 1
          ) as "phone"
        FROM employer_contacts ec
        INNER JOIN contacts c ON c.id = ec.contact_id
        INNER JOIN options_employer_contact_type ect ON ec.contact_type_id = ect.id
        WHERE ect.name = 'Principal'
        ORDER BY c.display_name
      `);
      return result.rows as unknown as OrganizingPrincipal[];
    },

    async getOrganizingDistinctStats(primaryStatusIds: string[]): Promise<OrganizingDistinctStat[]> {
      const client = getClient();
      const hasPrimaryFilter = primaryStatusIds.length > 0;
      const result = await client.execute(sql`
        WITH latest_employment AS (
          SELECT DISTINCT ON (wh.worker_id, wh.employer_id)
            wh.worker_id,
            wh.employer_id,
            wh.employment_status_id,
            es.employed as is_employed
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          ORDER BY wh.worker_id, wh.employer_id, wh.year DESC, wh.month DESC, wh.day DESC
        ),
        active_workers AS (
          SELECT DISTINCT le.worker_id
          FROM latest_employment le
          WHERE ${hasPrimaryFilter
            ? sql`le.employment_status_id IN (${sql.join(primaryStatusIds.map(id => sql`${id}`), sql`, `)})`
            : sql`le.is_employed = true`}
        )
        SELECT
          w.bargaining_unit_id as "bargainingUnitId",
          COUNT(DISTINCT aw.worker_id) as "totalDistinctWorkers",
          COUNT(DISTINCT CASE WHEN cc.status = 'signed' THEN aw.worker_id END) as "signedDistinctWorkers"
        FROM active_workers aw
        INNER JOIN workers w ON w.id = aw.worker_id
        LEFT JOIN cardchecks cc ON cc.worker_id = aw.worker_id AND cc.status = 'signed'
        GROUP BY w.bargaining_unit_id
      `);
      return (result.rows as any[]).map(row => ({
        bargainingUnitId: row.bargainingUnitId,
        totalDistinctWorkers: Number(row.totalDistinctWorkers) || 0,
        signedDistinctWorkers: Number(row.signedDistinctWorkers) || 0,
      }));
    },

    async getOrganizingNewMembers(days: number): Promise<OrganizingNewMember[]> {
      const client = getClient();
      const result = await client.execute(sql`
        WITH first_signed AS (
          SELECT
            cc.worker_id,
            MIN(cc.signed_date) as first_signed_date,
            (ARRAY_AGG(cc.bargaining_unit_id ORDER BY cc.signed_date ASC))[1] as bargaining_unit_id
          FROM cardchecks cc
          WHERE cc.status = 'signed'
          GROUP BY cc.worker_id
          HAVING MIN(cc.signed_date) >= CURRENT_DATE - ${days}::integer
        )
        SELECT
          fs.worker_id as "workerId",
          c.display_name as "displayName",
          fs.first_signed_date as "signedDate",
          bu.name as "bargainingUnitName",
          bu.id as "bargainingUnitId",
          COALESCE(
            (
              SELECT e.name
              FROM worker_hours wh
              INNER JOIN employers e ON e.id = wh.employer_id
              WHERE wh.worker_id = fs.worker_id
              ORDER BY wh.year DESC, wh.month DESC, wh.day DESC
              LIMIT 1
            ),
            'Unknown'
          ) as "employerName",
          COALESCE(
            (
              SELECT wh.employer_id
              FROM worker_hours wh
              WHERE wh.worker_id = fs.worker_id
              ORDER BY wh.year DESC, wh.month DESC, wh.day DESC
              LIMIT 1
            ),
            NULL
          ) as "employerId"
        FROM first_signed fs
        INNER JOIN workers w ON w.id = fs.worker_id
        INNER JOIN contacts c ON c.id = w.contact_id
        LEFT JOIN bargaining_units bu ON bu.id = fs.bargaining_unit_id
        ORDER BY fs.first_signed_date DESC, c.display_name
      `);
      return (result.rows as any[]).map(row => ({
        workerId: row.workerId,
        displayName: row.displayName,
        signedDate: row.signedDate,
        bargainingUnitName: row.bargainingUnitName || null,
        bargainingUnitId: row.bargainingUnitId,
        employerName: row.employerName,
        employerId: row.employerId,
      }));
    },

    async getMissingCardchecksForEmployer(employerId: string, primaryStatusIds: string[]): Promise<MissingCardcheckWorkerRow[]> {
      const client = getClient();
      const hasPrimaryFilter = primaryStatusIds.length > 0;
      const result = await client.execute(sql`
        WITH latest_employment AS (
          SELECT DISTINCT ON (wh.worker_id)
            wh.worker_id,
            wh.employment_status_id,
            es.name as status_name,
            es.employed as is_employed,
            make_date(wh.year, wh.month, wh.day) as status_date
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          WHERE wh.employer_id = ${employerId}
          ORDER BY wh.worker_id, wh.year DESC, wh.month DESC, wh.day DESC
        ),
        active_workers AS (
          SELECT le.worker_id, le.status_date as current_active_date, le.status_name
          FROM latest_employment le
          WHERE ${hasPrimaryFilter
            ? sql`le.employment_status_id IN (${sql.join(primaryStatusIds.map(id => sql`${id}`), sql`, `)})`
            : sql`le.is_employed = true`}
        ),
        latest_signed_cardcheck AS (
          SELECT DISTINCT ON (cc.worker_id)
            cc.worker_id,
            cc.bargaining_unit_id,
            cc.signed_date
          FROM cardchecks cc
          WHERE cc.status = 'signed'
          ORDER BY cc.worker_id, cc.signed_date DESC NULLS LAST
        ),
        status_with_next AS (
          SELECT
            wh.worker_id,
            es.name as status_name,
            es.employed as is_employed,
            make_date(wh.year, wh.month, wh.day) as status_date,
            LEAD(es.employed) OVER (PARTITION BY wh.worker_id ORDER BY wh.year, wh.month, wh.day) as next_employed,
            LEAD(make_date(wh.year, wh.month, wh.day)) OVER (PARTITION BY wh.worker_id ORDER BY wh.year, wh.month, wh.day) as next_date
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          WHERE wh.employer_id = ${employerId}
        ),
        termination_requiring_new_cardcheck AS (
          SELECT DISTINCT ON (aw.worker_id)
            aw.worker_id,
            swn.status_date as termination_date,
            swn.next_date as return_active_date
          FROM active_workers aw
          INNER JOIN status_with_next swn ON swn.worker_id = aw.worker_id
          WHERE swn.is_employed = false
            AND swn.next_employed = true
            AND swn.next_date = aw.current_active_date
            AND (swn.next_date - swn.status_date) >= 30
          ORDER BY aw.worker_id, swn.status_date DESC
        ),
        worker_invalid_reasons AS (
          SELECT DISTINCT ON (aw.worker_id)
            aw.worker_id,
            CASE
              WHEN lsc.worker_id IS NULL THEN 'Missing'
              WHEN trn.worker_id IS NOT NULL
                   AND (lsc.signed_date IS NULL OR lsc.signed_date < trn.termination_date)
              THEN 'Termination Expired'
              WHEN w.bargaining_unit_id IS NOT NULL
                   AND lsc.bargaining_unit_id IS NOT NULL
                   AND w.bargaining_unit_id != lsc.bargaining_unit_id
              THEN 'BU Mismatch'
              ELSE NULL
            END as invalid_reason
          FROM active_workers aw
          INNER JOIN workers w ON w.id = aw.worker_id
          LEFT JOIN latest_signed_cardcheck lsc ON lsc.worker_id = aw.worker_id
          LEFT JOIN termination_requiring_new_cardcheck trn ON trn.worker_id = aw.worker_id
          ORDER BY aw.worker_id
        )
        SELECT
          w.id as "workerId",
          c.display_name as "displayName",
          c.email,
          bu.id as "bargainingUnitId",
          bu.name as "bargainingUnitName",
          wir.invalid_reason as "invalidReason",
          aw.status_name as "employmentStatus",
          (
            SELECT cp.phone_number
            FROM contact_phone cp
            WHERE cp.contact_id = c.id AND cp.is_active = true
            ORDER BY cp.is_primary DESC NULLS LAST
            LIMIT 1
          ) as phone
        FROM worker_invalid_reasons wir
        INNER JOIN workers w ON w.id = wir.worker_id
        INNER JOIN contacts c ON c.id = w.contact_id
        INNER JOIN active_workers aw ON aw.worker_id = w.id
        LEFT JOIN bargaining_units bu ON bu.id = w.bargaining_unit_id
        WHERE wir.invalid_reason IS NOT NULL
        ORDER BY
          CASE wir.invalid_reason
            WHEN 'Missing' THEN 1
            WHEN 'Termination Expired' THEN 2
            WHEN 'BU Mismatch' THEN 3
          END,
          c.display_name
      `);
      return result.rows as unknown as MissingCardcheckWorkerRow[];
    },
  };

  return storage;
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
        const { storage } = await import('./index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || args[0]?.workerId);
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
        const { storage } = await import('./index');
        const workerName = await storage.workers.getWorkerDisplayName(workerId);
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
        const { storage } = await import('./index');
        const workerName = await storage.workers.getWorkerDisplayName(workerId);
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
        const { storage } = await import('./index');
        const workerName = await storage.workers.getWorkerDisplayName(workerId);
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
