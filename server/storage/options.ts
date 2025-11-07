import { db } from "../db";
import { 
  optionsGender, 
  optionsWorkerIdType, 
  optionsTrustBenefitType, 
  optionsLedgerPaymentType,
  type GenderOption, 
  type InsertGenderOption,
  type WorkerIdType, 
  type InsertWorkerIdType,
  type TrustBenefitType, 
  type InsertTrustBenefitType,
  type LedgerPaymentType, 
  type InsertLedgerPaymentType
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

export interface OptionsStorage {
  gender: GenderOptionStorage;
  workerIdTypes: WorkerIdTypeStorage;
  trustBenefitTypes: TrustBenefitTypeStorage;
  ledgerPaymentTypes: LedgerPaymentTypeStorage;
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
    }
  };
}
