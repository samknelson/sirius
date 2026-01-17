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
  createStorageValidator
} from "./utils/validation";
import { calculateDenormActive } from "./utils/denorm-active";
import { normalizeToDateOnly } from "@shared/utils";
import { type WorkerSkillStorage } from "./worker-skills";

/**
 * Interface for certification option data that may contain skill associations
 */
interface CertificationData {
  skills?: string[];
  icon?: string;
  defaultDuration?: number;
}

/**
 * Dependencies required by worker certification storage
 */
export interface WorkerCertificationDependencies {
  workerSkills: WorkerSkillStorage;
}

/**
 * Syncs worker skills based on their active certifications.
 * - Grants skills from active certifications that the worker doesn't already have
 * - Removes skills that were previously granted by certifications but are no longer covered
 * - Preserves manually assigned skills (skills not associated with any certification option)
 */
async function syncWorkerSkillsFromCertifications(
  workerId: string,
  deps: WorkerCertificationDependencies
): Promise<void> {
  const client = getClient();
  
  // Get ALL certification options to determine which skills are "certification-managed"
  // This ensures we can properly remove skills even when their granting certification is deleted
  const allCertOptions = await client.select().from(optionsCertifications);
  
  // Build set of all skills that ANY certification option can grant
  // These are the only skills we're allowed to manage (grant/revoke)
  const certificationManagedSkills = new Set<string>();
  for (const certOption of allCertOptions) {
    const certData = certOption.data as CertificationData | null;
    const skills = certData?.skills || [];
    for (const skillId of skills) {
      certificationManagedSkills.add(skillId);
    }
  }
  
  // Get all certifications for this worker with their certification option details
  const workerCerts = await client
    .select({
      workerCertification: workerCertifications,
      certification: optionsCertifications,
    })
    .from(workerCertifications)
    .leftJoin(optionsCertifications, eq(workerCertifications.certificationId, optionsCertifications.id))
    .where(eq(workerCertifications.workerId, workerId));
  
  // Collect all skill IDs that should be granted from active certifications
  const skillsToGrant = new Set<string>();
  
  for (const { workerCertification, certification } of workerCerts) {
    if (!workerCertification.denormActive || !certification) continue;
    
    const certData = certification.data as CertificationData | null;
    const skills = certData?.skills || [];
    
    for (const skillId of skills) {
      skillsToGrant.add(skillId);
    }
  }
  
  // Get worker's current skills
  const currentSkills = await deps.workerSkills.getByWorker(workerId);
  const currentSkillIds = new Set(currentSkills.map(s => s.skillId));
  
  // Grant skills that the worker doesn't have yet
  for (const skillId of Array.from(skillsToGrant)) {
    if (!currentSkillIds.has(skillId)) {
      await deps.workerSkills.create({
        workerId,
        skillId,
        message: 'Auto-granted from active certification'
      });
    }
  }
  
  // Remove skills that are:
  // 1. Managed by certifications (part of ANY certification option's skill set)
  // 2. No longer granted by any active certification for this worker
  // This preserves manually assigned skills (skills not in any certification option)
  for (const currentSkill of currentSkills) {
    if (certificationManagedSkills.has(currentSkill.skillId) && !skillsToGrant.has(currentSkill.skillId)) {
      await deps.workerSkills.delete(currentSkill.id, 'Removed: no active certification grants this skill');
    }
  }
}

/**
 * Validator for worker certifications.
 * Use validate.validate() for ValidationResult or validate.validateOrThrow() for direct value.
 */
export const validate = createStorageValidator<InsertWorkerCertification, WorkerCertification, { denormActive: boolean }>(
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
    const denormActive = calculateDenormActive({
      startDate,
      endDate,
      requireStartDate: true,
      requireEndDate: false,
      customize: (defaultActive) => defaultActive && finalStatus === 'granted'
    });
    
    return { ok: true, value: { denormActive } };
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

export function createWorkerCertificationStorage(deps: WorkerCertificationDependencies): WorkerCertificationStorage {
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
          denormActive: validated.denormActive
        })
        .returning();
      
      // Sync skills based on updated certification status
      await syncWorkerSkillsFromCertifications(result.workerId, deps);
      
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
          denormActive: validated.denormActive
        })
        .where(eq(workerCertifications.id, id))
        .returning();
      
      // Sync skills for the current worker
      await syncWorkerSkillsFromCertifications(result.workerId, deps);
      
      // If workerId changed, also sync skills for the previous worker
      // to remove any skills that were granted by this certification
      if (existing.workerId !== result.workerId) {
        await syncWorkerSkillsFromCertifications(existing.workerId, deps);
      }
      
      return result;
    },

    async delete(id: string, message?: string): Promise<boolean> {
      const client = getClient();
      const [deleted] = await client
        .delete(workerCertifications)
        .where(eq(workerCertifications.id, id))
        .returning();
      
      if (deleted) {
        // Sync skills based on remaining certifications after delete
        await syncWorkerSkillsFromCertifications(deleted.workerId, deps);
      }
      
      return !!deleted;
    },

    async findExpiredButActive(): Promise<WorkerCertification[]> {
      const client = getClient();
      const all = await client.select().from(workerCertifications);
      return all.filter(cert => {
        const shouldBeActive = calculateDenormActive({
          startDate: cert.startDate,
          endDate: cert.endDate,
          requireStartDate: true,
          requireEndDate: true,
          customize: (defaultActive) => defaultActive && cert.status === 'granted'
        });
        return cert.denormActive && !shouldBeActive;
      });
    },

    async findNotExpiredButInactive(): Promise<WorkerCertification[]> {
      const client = getClient();
      const all = await client.select().from(workerCertifications);
      return all.filter(cert => {
        const shouldBeActive = calculateDenormActive({
          startDate: cert.startDate,
          endDate: cert.endDate,
          requireStartDate: true,
          requireEndDate: true,
          customize: (defaultActive) => defaultActive && cert.status === 'granted'
        });
        return !cert.denormActive && shouldBeActive;
      });
    },
  };
}
