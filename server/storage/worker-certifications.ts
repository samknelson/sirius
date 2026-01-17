import { getClient } from './transaction-context';
import { 
  workerCertifications,
  optionsCertifications,
  workers,
  contacts,
  type WorkerCertification, 
  type InsertWorkerCertification,
  type OptionsCertification
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { 
  type ValidationError,
  normalizeToDateOnly,
  getTodayDateOnly,
  createStorageValidator
} from "./utils/validation";

function calculateActiveStatus(
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined,
  status: string
): boolean {
  if (status !== 'granted') {
    return false;
  }
  
  if (startDate == null || endDate == null) {
    return false;
  }
  
  const start = normalizeToDateOnly(startDate);
  const end = normalizeToDateOnly(endDate);
  const today = getTodayDateOnly();
  
  return start !== null && end !== null && start <= today && today <= end;
}

/**
 * Validator for worker certifications.
 * Use validate.validate() for ValidationResult or validate.validateOrThrow() for direct value.
 */
export const validate = createStorageValidator<InsertWorkerCertification, WorkerCertification, { active: boolean }>(
  (data, existing) => {
    const errors: ValidationError[] = [];
    
    const workerId = data.workerId ?? existing?.workerId;
    const certificationId = data.certificationId ?? existing?.certificationId;
    const status = data.status !== undefined ? data.status : existing?.status;
    const startDate = data.startDate !== undefined ? data.startDate : existing?.startDate;
    const endDate = data.endDate !== undefined ? data.endDate : existing?.endDate;
    
    if (!workerId) {
      errors.push({ field: 'workerId', code: 'REQUIRED', message: 'Worker ID is required' });
    }
    
    if (!certificationId) {
      errors.push({ field: 'certificationId', code: 'REQUIRED', message: 'Certification ID is required' });
    }
    
    if (startDate && endDate) {
      const normalizedStart = normalizeToDateOnly(startDate);
      const normalizedEnd = normalizeToDateOnly(endDate);
      
      if (normalizedStart && normalizedEnd && normalizedStart > normalizedEnd) {
        errors.push({ field: 'endDate', code: 'BEFORE_START', message: 'End date cannot be before start date' });
      }
    }
    
    if (errors.length > 0) {
      return { ok: false, errors };
    }
    
    const finalStatus = status ?? 'pending';
    const active = calculateActiveStatus(startDate, endDate, finalStatus);
    
    return { ok: true, value: { active } };
  }
);

export interface WorkerCertificationWithDetails extends WorkerCertification {
  certification?: OptionsCertification | null;
}

export interface WorkerCertificationStorage {
  getAll(): Promise<WorkerCertification[]>;
  getByWorker(workerId: string): Promise<WorkerCertificationWithDetails[]>;
  get(id: string): Promise<WorkerCertificationWithDetails | undefined>;
  create(data: InsertWorkerCertification & { message?: string }): Promise<WorkerCertification>;
  update(id: string, data: Partial<InsertWorkerCertification> & { message?: string }): Promise<WorkerCertification | undefined>;
  delete(id: string, message?: string): Promise<boolean>;
  findExpiredButActive(): Promise<WorkerCertification[]>;
  findNotExpiredButInactive(): Promise<WorkerCertification[]>;
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

async function getCertificationName(certificationId: string): Promise<string> {
  const client = getClient();
  const [cert] = await client
    .select({ name: optionsCertifications.name })
    .from(optionsCertifications)
    .where(eq(optionsCertifications.id, certificationId));
  return cert?.name || 'Unknown Certification';
}

export const workerCertificationLoggingConfig: StorageLoggingConfig<WorkerCertificationStorage> = {
  module: 'worker-certifications',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker certification',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const certName = await getCertificationName(result?.certificationId || args[0]?.certificationId);
        const message = args[0]?.message;
        const baseDesc = `Added certification "${certName}" to ${workerName}`;
        return message ? `${baseDesc}: ${message}` : baseDesc;
      },
      after: async (args, result) => {
        return { workerCertification: result };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.workerCertification?.workerId || result?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(beforeState?.workerCertification?.workerId || result?.workerId || '');
        const certName = await getCertificationName(beforeState?.workerCertification?.certificationId || result?.certificationId || '');
        const message = args[1]?.message;
        const baseDesc = `Updated certification "${certName}" for ${workerName}`;
        return message ? `${baseDesc}: ${message}` : baseDesc;
      },
      before: async (args, storage) => {
        const workerCertification = await storage.get(args[0]);
        return { workerCertification };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.workerCertification?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(beforeState?.workerCertification?.workerId || '');
        const certName = await getCertificationName(beforeState?.workerCertification?.certificationId || '');
        const message = args[1];
        const baseDesc = `Removed certification "${certName}" from ${workerName}`;
        return message ? `${baseDesc}: ${message}` : baseDesc;
      },
      before: async (args, storage) => {
        const workerCertification = await storage.get(args[0]);
        return { workerCertification };
      }
    }
  }
};

export function createWorkerCertificationStorage(): WorkerCertificationStorage {
  return {
    async getAll(): Promise<WorkerCertification[]> {
      const client = getClient();
      return client.select().from(workerCertifications);
    },

    async getByWorker(workerId: string): Promise<WorkerCertificationWithDetails[]> {
      const client = getClient();
      const results = await client
        .select({
          workerCertification: workerCertifications,
          certification: optionsCertifications,
        })
        .from(workerCertifications)
        .leftJoin(optionsCertifications, eq(workerCertifications.certificationId, optionsCertifications.id))
        .where(eq(workerCertifications.workerId, workerId));
      
      return results.map(r => ({
        ...r.workerCertification,
        certification: r.certification,
      }));
    },

    async get(id: string): Promise<WorkerCertificationWithDetails | undefined> {
      const client = getClient();
      const [result] = await client
        .select({
          workerCertification: workerCertifications,
          certification: optionsCertifications,
        })
        .from(workerCertifications)
        .leftJoin(optionsCertifications, eq(workerCertifications.certificationId, optionsCertifications.id))
        .where(eq(workerCertifications.id, id));
      
      if (!result) return undefined;
      
      return {
        ...result.workerCertification,
        certification: result.certification,
      };
    },

    async create(data: InsertWorkerCertification & { message?: string }): Promise<WorkerCertification> {
      const client = getClient();
      const { message, ...insertData } = data;
      
      const validated = validate.validateOrThrow(insertData);
      
      const [result] = await client
        .insert(workerCertifications)
        .values({
          ...insertData,
          active: validated.active
        })
        .returning();
      
      return result;
    },

    async update(id: string, data: Partial<InsertWorkerCertification> & { message?: string }): Promise<WorkerCertification | undefined> {
      const client = getClient();
      const { message, ...updateData } = data;
      
      const [existing] = await client
        .select()
        .from(workerCertifications)
        .where(eq(workerCertifications.id, id));
      
      if (!existing) return undefined;
      
      const validated = validate.validateOrThrow(updateData, existing);
      
      const [result] = await client
        .update(workerCertifications)
        .set({
          ...updateData,
          active: validated.active
        })
        .where(eq(workerCertifications.id, id))
        .returning();
      
      return result;
    },

    async delete(id: string, message?: string): Promise<boolean> {
      const client = getClient();
      const [deleted] = await client
        .delete(workerCertifications)
        .where(eq(workerCertifications.id, id))
        .returning();
      
      return !!deleted;
    },

    async findExpiredButActive(): Promise<WorkerCertification[]> {
      const client = getClient();
      const all = await client.select().from(workerCertifications);
      return all.filter(cert => {
        const shouldBeActive = calculateActiveStatus(cert.startDate, cert.endDate, cert.status);
        return cert.active && !shouldBeActive;
      });
    },

    async findNotExpiredButInactive(): Promise<WorkerCertification[]> {
      const client = getClient();
      const all = await client.select().from(workerCertifications);
      return all.filter(cert => {
        const shouldBeActive = calculateActiveStatus(cert.startDate, cert.endDate, cert.status);
        return !cert.active && shouldBeActive;
      });
    },
  };
}
