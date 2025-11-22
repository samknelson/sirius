import { db } from "../db";
import { 
  optionsGender, 
  optionsWorkerIdType, 
  optionsTrustBenefitType, 
  optionsLedgerPaymentType,
  optionsEmployerContactType,
  optionsTrustProviderType,
  optionsWorkerWs,
  optionsEmploymentStatus,
  type GenderOption, 
  type InsertGenderOption,
  type WorkerIdType, 
  type InsertWorkerIdType,
  type TrustBenefitType, 
  type InsertTrustBenefitType,
  type LedgerPaymentType, 
  type InsertLedgerPaymentType,
  type EmployerContactType,
  type InsertEmployerContactType,
  type TrustProviderType,
  type InsertTrustProviderType,
  type WorkerWs,
  type InsertWorkerWs,
  type EmploymentStatus,
  type InsertEmploymentStatus
} from "@shared/schema";
import { eq } from "drizzle-orm";

export interface GenderOptionStorage {
  getAllGenderOptions(): Promise<GenderOption[]>;
  getGenderOption(id: string): Promise<GenderOption | undefined>;
  createGenderOption(genderOption: InsertGenderOption): Promise<GenderOption>;
  updateGenderOption(id: string, genderOption: Partial<InsertGenderOption>): Promise<GenderOption | undefined>;
  deleteGenderOption(id: string): Promise<boolean>;
  updateGenderOptionSequence(id: string, sequence: number): Promise<GenderOption | undefined>;
}

export interface WorkerIdTypeStorage {
  getAllWorkerIdTypes(): Promise<WorkerIdType[]>;
  getWorkerIdType(id: string): Promise<WorkerIdType | undefined>;
  createWorkerIdType(workerIdType: InsertWorkerIdType): Promise<WorkerIdType>;
  updateWorkerIdType(id: string, workerIdType: Partial<InsertWorkerIdType>): Promise<WorkerIdType | undefined>;
  deleteWorkerIdType(id: string): Promise<boolean>;
  updateWorkerIdTypeSequence(id: string, sequence: number): Promise<WorkerIdType | undefined>;
}

export interface TrustBenefitTypeStorage {
  getAllTrustBenefitTypes(): Promise<TrustBenefitType[]>;
  getTrustBenefitType(id: string): Promise<TrustBenefitType | undefined>;
  createTrustBenefitType(trustBenefitType: InsertTrustBenefitType): Promise<TrustBenefitType>;
  updateTrustBenefitType(id: string, trustBenefitType: Partial<InsertTrustBenefitType>): Promise<TrustBenefitType | undefined>;
  deleteTrustBenefitType(id: string): Promise<boolean>;
  updateTrustBenefitTypeSequence(id: string, sequence: number): Promise<TrustBenefitType | undefined>;
}

export interface LedgerPaymentTypeStorage {
  getAllLedgerPaymentTypes(): Promise<LedgerPaymentType[]>;
  getLedgerPaymentType(id: string): Promise<LedgerPaymentType | undefined>;
  createLedgerPaymentType(paymentType: InsertLedgerPaymentType): Promise<LedgerPaymentType>;
  updateLedgerPaymentType(id: string, paymentType: Partial<InsertLedgerPaymentType>): Promise<LedgerPaymentType | undefined>;
  deleteLedgerPaymentType(id: string): Promise<boolean>;
  updateLedgerPaymentTypeSequence(id: string, sequence: number): Promise<LedgerPaymentType | undefined>;
}

export interface EmployerContactTypeStorage {
  getAll(): Promise<EmployerContactType[]>;
  get(id: string): Promise<EmployerContactType | undefined>;
  create(contactType: InsertEmployerContactType): Promise<EmployerContactType>;
  update(id: string, contactType: Partial<InsertEmployerContactType>): Promise<EmployerContactType | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface TrustProviderTypeStorage {
  getAll(): Promise<TrustProviderType[]>;
  get(id: string): Promise<TrustProviderType | undefined>;
  create(providerType: InsertTrustProviderType): Promise<TrustProviderType>;
  update(id: string, providerType: Partial<InsertTrustProviderType>): Promise<TrustProviderType | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface WorkerWsStorage {
  getAll(): Promise<WorkerWs[]>;
  get(id: string): Promise<WorkerWs | undefined>;
  create(ws: InsertWorkerWs): Promise<WorkerWs>;
  update(id: string, ws: Partial<InsertWorkerWs>): Promise<WorkerWs | undefined>;
  delete(id: string): Promise<boolean>;
  updateSequence(id: string, sequence: number): Promise<WorkerWs | undefined>;
}

export interface EmploymentStatusStorage {
  getAll(): Promise<EmploymentStatus[]>;
  get(id: string): Promise<EmploymentStatus | undefined>;
  create(status: InsertEmploymentStatus): Promise<EmploymentStatus>;
  update(id: string, status: Partial<InsertEmploymentStatus>): Promise<EmploymentStatus | undefined>;
  delete(id: string): Promise<boolean>;
  updateSequence(id: string, sequence: number): Promise<EmploymentStatus | undefined>;
}

export interface OptionsStorage {
  gender: GenderOptionStorage;
  workerIdTypes: WorkerIdTypeStorage;
  trustBenefitTypes: TrustBenefitTypeStorage;
  ledgerPaymentTypes: LedgerPaymentTypeStorage;
  employerContactTypes: EmployerContactTypeStorage;
  trustProviderTypes: TrustProviderTypeStorage;
  workerWs: WorkerWsStorage;
  employmentStatus: EmploymentStatusStorage;
}

export function createOptionsStorage(): OptionsStorage {
  return {
    gender: {
      async getAllGenderOptions(): Promise<GenderOption[]> {
        return db.select().from(optionsGender).orderBy(optionsGender.sequence);
      },

      async getGenderOption(id: string): Promise<GenderOption | undefined> {
        const [genderOption] = await db.select().from(optionsGender).where(eq(optionsGender.id, id));
        return genderOption || undefined;
      },

      async createGenderOption(insertGenderOption: InsertGenderOption): Promise<GenderOption> {
        const [genderOption] = await db
          .insert(optionsGender)
          .values(insertGenderOption)
          .returning();
        return genderOption;
      },

      async updateGenderOption(id: string, genderOptionUpdate: Partial<InsertGenderOption>): Promise<GenderOption | undefined> {
        const [genderOption] = await db
          .update(optionsGender)
          .set(genderOptionUpdate)
          .where(eq(optionsGender.id, id))
          .returning();
        return genderOption || undefined;
      },

      async deleteGenderOption(id: string): Promise<boolean> {
        const result = await db.delete(optionsGender).where(eq(optionsGender.id, id)).returning();
        return result.length > 0;
      },

      async updateGenderOptionSequence(id: string, sequence: number): Promise<GenderOption | undefined> {
        return this.updateGenderOption(id, { sequence });
      }
    },

    workerIdTypes: {
      async getAllWorkerIdTypes(): Promise<WorkerIdType[]> {
        return db.select().from(optionsWorkerIdType).orderBy(optionsWorkerIdType.sequence);
      },

      async getWorkerIdType(id: string): Promise<WorkerIdType | undefined> {
        const [workerIdType] = await db.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, id));
        return workerIdType || undefined;
      },

      async createWorkerIdType(insertWorkerIdType: InsertWorkerIdType): Promise<WorkerIdType> {
        const [workerIdType] = await db
          .insert(optionsWorkerIdType)
          .values(insertWorkerIdType)
          .returning();
        return workerIdType;
      },

      async updateWorkerIdType(id: string, workerIdTypeUpdate: Partial<InsertWorkerIdType>): Promise<WorkerIdType | undefined> {
        const [workerIdType] = await db
          .update(optionsWorkerIdType)
          .set(workerIdTypeUpdate)
          .where(eq(optionsWorkerIdType.id, id))
          .returning();
        return workerIdType || undefined;
      },

      async deleteWorkerIdType(id: string): Promise<boolean> {
        const result = await db.delete(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, id)).returning();
        return result.length > 0;
      },

      async updateWorkerIdTypeSequence(id: string, sequence: number): Promise<WorkerIdType | undefined> {
        return this.updateWorkerIdType(id, { sequence });
      }
    },

    trustBenefitTypes: {
      async getAllTrustBenefitTypes(): Promise<TrustBenefitType[]> {
        return db.select().from(optionsTrustBenefitType).orderBy(optionsTrustBenefitType.sequence);
      },

      async getTrustBenefitType(id: string): Promise<TrustBenefitType | undefined> {
        const [trustBenefitType] = await db.select().from(optionsTrustBenefitType).where(eq(optionsTrustBenefitType.id, id));
        return trustBenefitType || undefined;
      },

      async createTrustBenefitType(insertTrustBenefitType: InsertTrustBenefitType): Promise<TrustBenefitType> {
        const [trustBenefitType] = await db
          .insert(optionsTrustBenefitType)
          .values(insertTrustBenefitType)
          .returning();
        return trustBenefitType;
      },

      async updateTrustBenefitType(id: string, trustBenefitTypeUpdate: Partial<InsertTrustBenefitType>): Promise<TrustBenefitType | undefined> {
        const [trustBenefitType] = await db
          .update(optionsTrustBenefitType)
          .set(trustBenefitTypeUpdate)
          .where(eq(optionsTrustBenefitType.id, id))
          .returning();
        return trustBenefitType || undefined;
      },

      async deleteTrustBenefitType(id: string): Promise<boolean> {
        const result = await db.delete(optionsTrustBenefitType).where(eq(optionsTrustBenefitType.id, id)).returning();
        return result.length > 0;
      },

      async updateTrustBenefitTypeSequence(id: string, sequence: number): Promise<TrustBenefitType | undefined> {
        return this.updateTrustBenefitType(id, { sequence });
      }
    },

    ledgerPaymentTypes: {
      async getAllLedgerPaymentTypes(): Promise<LedgerPaymentType[]> {
        return db.select().from(optionsLedgerPaymentType).orderBy(optionsLedgerPaymentType.sequence);
      },

      async getLedgerPaymentType(id: string): Promise<LedgerPaymentType | undefined> {
        const [paymentType] = await db.select().from(optionsLedgerPaymentType).where(eq(optionsLedgerPaymentType.id, id));
        return paymentType || undefined;
      },

      async createLedgerPaymentType(insertPaymentType: InsertLedgerPaymentType): Promise<LedgerPaymentType> {
        const [paymentType] = await db
          .insert(optionsLedgerPaymentType)
          .values(insertPaymentType)
          .returning();
        return paymentType;
      },

      async updateLedgerPaymentType(id: string, paymentTypeUpdate: Partial<InsertLedgerPaymentType>): Promise<LedgerPaymentType | undefined> {
        const [paymentType] = await db
          .update(optionsLedgerPaymentType)
          .set(paymentTypeUpdate)
          .where(eq(optionsLedgerPaymentType.id, id))
          .returning();
        return paymentType || undefined;
      },

      async deleteLedgerPaymentType(id: string): Promise<boolean> {
        const result = await db.delete(optionsLedgerPaymentType).where(eq(optionsLedgerPaymentType.id, id)).returning();
        return result.length > 0;
      },

      async updateLedgerPaymentTypeSequence(id: string, sequence: number): Promise<LedgerPaymentType | undefined> {
        return this.updateLedgerPaymentType(id, { sequence });
      }
    },

    employerContactTypes: {
      async getAll(): Promise<EmployerContactType[]> {
        return db.select().from(optionsEmployerContactType);
      },

      async get(id: string): Promise<EmployerContactType | undefined> {
        const [contactType] = await db.select().from(optionsEmployerContactType).where(eq(optionsEmployerContactType.id, id));
        return contactType || undefined;
      },

      async create(insertContactType: InsertEmployerContactType): Promise<EmployerContactType> {
        const [contactType] = await db
          .insert(optionsEmployerContactType)
          .values(insertContactType)
          .returning();
        return contactType;
      },

      async update(id: string, contactTypeUpdate: Partial<InsertEmployerContactType>): Promise<EmployerContactType | undefined> {
        const [contactType] = await db
          .update(optionsEmployerContactType)
          .set(contactTypeUpdate)
          .where(eq(optionsEmployerContactType.id, id))
          .returning();
        return contactType || undefined;
      },

      async delete(id: string): Promise<boolean> {
        const result = await db.delete(optionsEmployerContactType).where(eq(optionsEmployerContactType.id, id)).returning();
        return result.length > 0;
      }
    },

    trustProviderTypes: {
      async getAll(): Promise<TrustProviderType[]> {
        return db.select().from(optionsTrustProviderType);
      },

      async get(id: string): Promise<TrustProviderType | undefined> {
        const [providerType] = await db.select().from(optionsTrustProviderType).where(eq(optionsTrustProviderType.id, id));
        return providerType || undefined;
      },

      async create(insertProviderType: InsertTrustProviderType): Promise<TrustProviderType> {
        const [providerType] = await db
          .insert(optionsTrustProviderType)
          .values(insertProviderType)
          .returning();
        return providerType;
      },

      async update(id: string, providerTypeUpdate: Partial<InsertTrustProviderType>): Promise<TrustProviderType | undefined> {
        const [providerType] = await db
          .update(optionsTrustProviderType)
          .set(providerTypeUpdate)
          .where(eq(optionsTrustProviderType.id, id))
          .returning();
        return providerType || undefined;
      },

      async delete(id: string): Promise<boolean> {
        const result = await db.delete(optionsTrustProviderType).where(eq(optionsTrustProviderType.id, id)).returning();
        return result.length > 0;
      }
    },

    workerWs: {
      async getAll(): Promise<WorkerWs[]> {
        return db.select().from(optionsWorkerWs).orderBy(optionsWorkerWs.sequence);
      },

      async get(id: string): Promise<WorkerWs | undefined> {
        const [ws] = await db.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, id));
        return ws || undefined;
      },

      async create(insertWs: InsertWorkerWs): Promise<WorkerWs> {
        const [ws] = await db
          .insert(optionsWorkerWs)
          .values(insertWs)
          .returning();
        return ws;
      },

      async update(id: string, wsUpdate: Partial<InsertWorkerWs>): Promise<WorkerWs | undefined> {
        const [ws] = await db
          .update(optionsWorkerWs)
          .set(wsUpdate)
          .where(eq(optionsWorkerWs.id, id))
          .returning();
        return ws || undefined;
      },

      async delete(id: string): Promise<boolean> {
        const result = await db.delete(optionsWorkerWs).where(eq(optionsWorkerWs.id, id)).returning();
        return result.length > 0;
      },

      async updateSequence(id: string, sequence: number): Promise<WorkerWs | undefined> {
        return this.update(id, { sequence });
      }
    },

    employmentStatus: {
      async getAll(): Promise<EmploymentStatus[]> {
        return db.select().from(optionsEmploymentStatus).orderBy(optionsEmploymentStatus.sequence);
      },

      async get(id: string): Promise<EmploymentStatus | undefined> {
        const [status] = await db.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, id));
        return status || undefined;
      },

      async create(insertStatus: InsertEmploymentStatus): Promise<EmploymentStatus> {
        const [status] = await db
          .insert(optionsEmploymentStatus)
          .values(insertStatus)
          .returning();
        return status;
      },

      async update(id: string, statusUpdate: Partial<InsertEmploymentStatus>): Promise<EmploymentStatus | undefined> {
        const [status] = await db
          .update(optionsEmploymentStatus)
          .set(statusUpdate)
          .where(eq(optionsEmploymentStatus.id, id))
          .returning();
        return status || undefined;
      },

      async delete(id: string): Promise<boolean> {
        const result = await db.delete(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, id)).returning();
        return result.length > 0;
      },

      async updateSequence(id: string, sequence: number): Promise<EmploymentStatus | undefined> {
        return this.update(id, { sequence });
      }
    }
  };
}

export function createEmployerContactTypeStorage(): EmployerContactTypeStorage {
  return {
    async getAll(): Promise<EmployerContactType[]> {
      return db.select().from(optionsEmployerContactType);
    },

    async get(id: string): Promise<EmployerContactType | undefined> {
      const [contactType] = await db.select().from(optionsEmployerContactType).where(eq(optionsEmployerContactType.id, id));
      return contactType || undefined;
    },

    async create(insertContactType: InsertEmployerContactType): Promise<EmployerContactType> {
      const [contactType] = await db
        .insert(optionsEmployerContactType)
        .values(insertContactType)
        .returning();
      return contactType;
    },

    async update(id: string, contactTypeUpdate: Partial<InsertEmployerContactType>): Promise<EmployerContactType | undefined> {
      const [contactType] = await db
        .update(optionsEmployerContactType)
        .set(contactTypeUpdate)
        .where(eq(optionsEmployerContactType.id, id))
        .returning();
      return contactType || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(optionsEmployerContactType).where(eq(optionsEmployerContactType.id, id)).returning();
      return result.length > 0;
    }
  };
}
