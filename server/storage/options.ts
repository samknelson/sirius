import { db } from "../db";
import { 
  optionsGender, 
  optionsWorkerIdType, 
  optionsTrustBenefitType, 
  optionsLedgerPaymentType,
  optionsEmployerContactType,
  optionsEmployerType,
  optionsDepartment,
  optionsTrustProviderType,
  optionsWorkerWs,
  optionsEmploymentStatus,
  optionsEventType,
  optionsDispatchJobType,
  optionsSkills,
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
  type EmployerType,
  type InsertEmployerType,
  type Department,
  type InsertDepartment,
  type TrustProviderType,
  type InsertTrustProviderType,
  type WorkerWs,
  type InsertWorkerWs,
  type EmploymentStatus,
  type InsertEmploymentStatus,
  type EventType,
  type InsertEventType,
  type DispatchJobType,
  type InsertDispatchJobType,
  type OptionsSkill,
  type InsertOptionsSkill
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

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

export const employerContactTypeLoggingConfig: StorageLoggingConfig<EmployerContactTypeStorage> = {
  module: 'options.employerContactTypes',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new employer contact type',
      after: async (args, result, storage) => {
        return result;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      }
    }
  }
};

export interface EmployerTypeStorage {
  getAll(): Promise<EmployerType[]>;
  get(id: string): Promise<EmployerType | undefined>;
  create(employerType: InsertEmployerType): Promise<EmployerType>;
  update(id: string, employerType: Partial<InsertEmployerType>): Promise<EmployerType | undefined>;
  delete(id: string): Promise<boolean>;
  updateSequence(id: string, sequence: number): Promise<EmployerType | undefined>;
}

export const employerTypeLoggingConfig: StorageLoggingConfig<EmployerTypeStorage> = {
  module: 'options.employerTypes',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new employer type',
      after: async (args, result, storage) => {
        return result;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      }
    }
  }
};

export interface DepartmentStorage {
  getAll(): Promise<Department[]>;
  get(id: string): Promise<Department | undefined>;
  create(department: InsertDepartment): Promise<Department>;
  update(id: string, department: Partial<InsertDepartment>): Promise<Department | undefined>;
  delete(id: string): Promise<boolean>;
}

export const departmentLoggingConfig: StorageLoggingConfig<DepartmentStorage> = {
  module: 'options.departments',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new department',
      after: async (args, result, storage) => {
        return result;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      }
    }
  }
};

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

export interface EventTypeStorage {
  getAll(): Promise<EventType[]>;
  get(id: string): Promise<EventType | undefined>;
  create(eventType: InsertEventType): Promise<EventType>;
  update(id: string, eventType: Partial<InsertEventType>): Promise<EventType | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface DispatchJobTypeStorage {
  getAll(): Promise<DispatchJobType[]>;
  get(id: string): Promise<DispatchJobType | undefined>;
  create(jobType: InsertDispatchJobType): Promise<DispatchJobType>;
  update(id: string, jobType: Partial<InsertDispatchJobType>): Promise<DispatchJobType | undefined>;
  delete(id: string): Promise<boolean>;
}

export const dispatchJobTypeLoggingConfig: StorageLoggingConfig<DispatchJobTypeStorage> = {
  module: 'options.dispatchJobTypes',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new dispatch job type',
      after: async (args, result) => result
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0]),
      after: async (args, result) => result
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0])
    }
  }
};

export const eventTypeLoggingConfig: StorageLoggingConfig<EventTypeStorage> = {
  module: 'options.eventTypes',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new event type',
      after: async (args, result, storage) => {
        return result;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      }
    }
  }
};

export interface OptionsStorage {
  gender: GenderOptionStorage;
  workerIdTypes: WorkerIdTypeStorage;
  trustBenefitTypes: TrustBenefitTypeStorage;
  ledgerPaymentTypes: LedgerPaymentTypeStorage;
  employerContactTypes: EmployerContactTypeStorage;
  employerTypes: EmployerTypeStorage;
  departments: DepartmentStorage;
  trustProviderTypes: TrustProviderTypeStorage;
  workerWs: WorkerWsStorage;
  employmentStatus: EmploymentStatusStorage;
  eventTypes: EventTypeStorage;
  dispatchJobTypes: DispatchJobTypeStorage;
  skills: SkillsStorage;
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

    employerTypes: {
      async getAll(): Promise<EmployerType[]> {
        return db.select().from(optionsEmployerType).orderBy(optionsEmployerType.sequence);
      },

      async get(id: string): Promise<EmployerType | undefined> {
        const [employerType] = await db.select().from(optionsEmployerType).where(eq(optionsEmployerType.id, id));
        return employerType || undefined;
      },

      async create(insertEmployerType: InsertEmployerType): Promise<EmployerType> {
        const [employerType] = await db
          .insert(optionsEmployerType)
          .values(insertEmployerType)
          .returning();
        return employerType;
      },

      async update(id: string, employerTypeUpdate: Partial<InsertEmployerType>): Promise<EmployerType | undefined> {
        const [employerType] = await db
          .update(optionsEmployerType)
          .set(employerTypeUpdate)
          .where(eq(optionsEmployerType.id, id))
          .returning();
        return employerType || undefined;
      },

      async delete(id: string): Promise<boolean> {
        const result = await db.delete(optionsEmployerType).where(eq(optionsEmployerType.id, id)).returning();
        return result.length > 0;
      },

      async updateSequence(id: string, sequence: number): Promise<EmployerType | undefined> {
        return this.update(id, { sequence });
      }
    },

    departments: {
      async getAll(): Promise<Department[]> {
        return db.select().from(optionsDepartment);
      },

      async get(id: string): Promise<Department | undefined> {
        const [department] = await db.select().from(optionsDepartment).where(eq(optionsDepartment.id, id));
        return department || undefined;
      },

      async create(insertDepartment: InsertDepartment): Promise<Department> {
        const [department] = await db
          .insert(optionsDepartment)
          .values(insertDepartment)
          .returning();
        return department;
      },

      async update(id: string, departmentUpdate: Partial<InsertDepartment>): Promise<Department | undefined> {
        const [department] = await db
          .update(optionsDepartment)
          .set(departmentUpdate)
          .where(eq(optionsDepartment.id, id))
          .returning();
        return department || undefined;
      },

      async delete(id: string): Promise<boolean> {
        const result = await db.delete(optionsDepartment).where(eq(optionsDepartment.id, id)).returning();
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
    },

    eventTypes: {
      async getAll(): Promise<EventType[]> {
        return db.select().from(optionsEventType);
      },

      async get(id: string): Promise<EventType | undefined> {
        const [eventType] = await db.select().from(optionsEventType).where(eq(optionsEventType.id, id));
        return eventType || undefined;
      },

      async create(insertEventType: InsertEventType): Promise<EventType> {
        const [eventType] = await db
          .insert(optionsEventType)
          .values(insertEventType)
          .returning();
        return eventType;
      },

      async update(id: string, eventTypeUpdate: Partial<InsertEventType>): Promise<EventType | undefined> {
        const [eventType] = await db
          .update(optionsEventType)
          .set(eventTypeUpdate)
          .where(eq(optionsEventType.id, id))
          .returning();
        return eventType || undefined;
      },

      async delete(id: string): Promise<boolean> {
        const result = await db.delete(optionsEventType).where(eq(optionsEventType.id, id)).returning();
        return result.length > 0;
      }
    },

    dispatchJobTypes: {
      async getAll(): Promise<DispatchJobType[]> {
        return db.select().from(optionsDispatchJobType);
      },

      async get(id: string): Promise<DispatchJobType | undefined> {
        const [jobType] = await db.select().from(optionsDispatchJobType).where(eq(optionsDispatchJobType.id, id));
        return jobType || undefined;
      },

      async create(insertJobType: InsertDispatchJobType): Promise<DispatchJobType> {
        const [jobType] = await db
          .insert(optionsDispatchJobType)
          .values(insertJobType)
          .returning();
        return jobType;
      },

      async update(id: string, jobTypeUpdate: Partial<InsertDispatchJobType>): Promise<DispatchJobType | undefined> {
        const [jobType] = await db
          .update(optionsDispatchJobType)
          .set(jobTypeUpdate)
          .where(eq(optionsDispatchJobType.id, id))
          .returning();
        return jobType || undefined;
      },

      async delete(id: string): Promise<boolean> {
        const result = await db.delete(optionsDispatchJobType).where(eq(optionsDispatchJobType.id, id)).returning();
        return result.length > 0;
      }
    },

    skills: {
      async getAll(): Promise<OptionsSkill[]> {
        return db.select().from(optionsSkills).orderBy(optionsSkills.name);
      },

      async get(id: string): Promise<OptionsSkill | undefined> {
        const [skill] = await db.select().from(optionsSkills).where(eq(optionsSkills.id, id));
        return skill || undefined;
      },

      async create(skill: InsertOptionsSkill): Promise<OptionsSkill> {
        const [newSkill] = await db
          .insert(optionsSkills)
          .values(skill)
          .returning();
        return newSkill;
      },

      async update(id: string, skillUpdate: Partial<InsertOptionsSkill>): Promise<OptionsSkill | undefined> {
        const [skill] = await db
          .update(optionsSkills)
          .set(skillUpdate)
          .where(eq(optionsSkills.id, id))
          .returning();
        return skill || undefined;
      },

      async delete(id: string): Promise<boolean> {
        const result = await db.delete(optionsSkills).where(eq(optionsSkills.id, id)).returning();
        return result.length > 0;
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

export function createEmployerTypeStorage(): EmployerTypeStorage {
  return {
    async getAll(): Promise<EmployerType[]> {
      return db.select().from(optionsEmployerType).orderBy(optionsEmployerType.sequence);
    },

    async get(id: string): Promise<EmployerType | undefined> {
      const [employerType] = await db.select().from(optionsEmployerType).where(eq(optionsEmployerType.id, id));
      return employerType || undefined;
    },

    async create(insertEmployerType: InsertEmployerType): Promise<EmployerType> {
      const [employerType] = await db
        .insert(optionsEmployerType)
        .values(insertEmployerType)
        .returning();
      return employerType;
    },

    async update(id: string, employerTypeUpdate: Partial<InsertEmployerType>): Promise<EmployerType | undefined> {
      const [employerType] = await db
        .update(optionsEmployerType)
        .set(employerTypeUpdate)
        .where(eq(optionsEmployerType.id, id))
        .returning();
      return employerType || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(optionsEmployerType).where(eq(optionsEmployerType.id, id)).returning();
      return result.length > 0;
    },

    async updateSequence(id: string, sequence: number): Promise<EmployerType | undefined> {
      return this.update(id, { sequence });
    }
  };
}

