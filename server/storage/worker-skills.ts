import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { 
  workerSkills,
  optionsSkills,
  workers,
  contacts,
  type WorkerSkill, 
  type InsertWorkerSkill,
  type OptionsSkill
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { eventBus, EventType } from "../services/event-bus";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface WorkerSkillWithDetails extends WorkerSkill {
  skill?: OptionsSkill | null;
}

export interface WorkerSkillStorage {
  getAll(): Promise<WorkerSkill[]>;
  getByWorker(workerId: string): Promise<WorkerSkillWithDetails[]>;
  getByWorkerAndSkill(workerId: string, skillId: string): Promise<WorkerSkill | undefined>;
  get(id: string): Promise<WorkerSkill | undefined>;
  create(skill: InsertWorkerSkill & { message?: string }): Promise<WorkerSkill>;
  delete(id: string, message?: string): Promise<boolean>;
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

async function getSkillName(skillId: string): Promise<string> {
  const client = getClient();
  const [skill] = await client
    .select({ name: optionsSkills.name })
    .from(optionsSkills)
    .where(eq(optionsSkills.id, skillId));
  return skill?.name || 'Unknown Skill';
}

export const workerSkillLoggingConfig: StorageLoggingConfig<WorkerSkillStorage> = {
  module: 'worker-skills',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker skill',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const skillName = await getSkillName(result?.skillId || args[0]?.skillId);
        const message = args[0]?.message;
        const baseDesc = `Added skill "${skillName}" to ${workerName}`;
        return message ? `${baseDesc}: ${message}` : baseDesc;
      },
      after: async (args, result) => {
        return { workerSkill: result };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.workerSkill?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(beforeState?.workerSkill?.workerId || '');
        const skillName = await getSkillName(beforeState?.workerSkill?.skillId || '');
        const message = args[1];
        const baseDesc = `Removed skill "${skillName}" from ${workerName}`;
        return message ? `${baseDesc}: ${message}` : baseDesc;
      },
      before: async (args, storage) => {
        const workerSkill = await storage.get(args[0]);
        return { workerSkill };
      }
    }
  }
};

export function createWorkerSkillStorage(): WorkerSkillStorage {
  return {
    async getAll(): Promise<WorkerSkill[]> {
      const client = getClient();
      return client.select().from(workerSkills);
    },

    async getByWorker(workerId: string): Promise<WorkerSkillWithDetails[]> {
      const client = getClient();
      const results = await client
        .select({
          workerSkill: workerSkills,
          skill: optionsSkills,
        })
        .from(workerSkills)
        .leftJoin(optionsSkills, eq(workerSkills.skillId, optionsSkills.id))
        .where(eq(workerSkills.workerId, workerId));
      
      return results.map(r => ({
        ...r.workerSkill,
        skill: r.skill,
      }));
    },

    async get(id: string): Promise<WorkerSkill | undefined> {
      const client = getClient();
      const [result] = await client
        .select()
        .from(workerSkills)
        .where(eq(workerSkills.id, id));
      return result;
    },

    async getByWorkerAndSkill(workerId: string, skillId: string): Promise<WorkerSkill | undefined> {
      const client = getClient();
      const [result] = await client
        .select()
        .from(workerSkills)
        .where(and(eq(workerSkills.workerId, workerId), eq(workerSkills.skillId, skillId)));
      return result;
    },

    async create(data: InsertWorkerSkill & { message?: string }): Promise<WorkerSkill> {
      validate.validateOrThrow(data);
      const client = getClient();
      const { message, ...insertData } = data;
      const [result] = await client
        .insert(workerSkills)
        .values(insertData)
        .returning();
      
      setImmediate(() => {
        eventBus.emit(EventType.WORKER_SKILL_SAVED, {
          workerSkillId: result.id,
          workerId: result.workerId,
          skillId: result.skillId,
        });
      });
      
      return result;
    },

    async delete(id: string, message?: string): Promise<boolean> {
      const client = getClient();
      const [deleted] = await client
        .delete(workerSkills)
        .where(eq(workerSkills.id, id))
        .returning();
      
      if (deleted) {
        setImmediate(() => {
          eventBus.emit(EventType.WORKER_SKILL_SAVED, {
            workerSkillId: deleted.id,
            workerId: deleted.workerId,
            skillId: deleted.skillId,
            isDeleted: true,
          });
        });
      }
      
      return !!deleted;
    },
  };
}
