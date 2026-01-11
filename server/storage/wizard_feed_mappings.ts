import { db } from './db';
import { wizardFeedMappings, type WizardFeedMapping, type InsertWizardFeedMapping } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface WizardFeedMappingStorage {
  findByUserTypeAndHash(userId: string, type: string, firstRowHash: string): Promise<WizardFeedMapping | undefined>;
  create(mapping: InsertWizardFeedMapping): Promise<WizardFeedMapping>;
  update(id: string, updates: Partial<Omit<InsertWizardFeedMapping, 'id'>>): Promise<WizardFeedMapping | undefined>;
  delete(id: string): Promise<boolean>;
  listByUser(userId: string, type?: string): Promise<WizardFeedMapping[]>;
}

export function createWizardFeedMappingStorage(): WizardFeedMappingStorage {
  return {
    async findByUserTypeAndHash(
      userId: string, 
      type: string, 
      firstRowHash: string
    ): Promise<WizardFeedMapping | undefined> {
      const [mapping] = await db
        .select()
        .from(wizardFeedMappings)
        .where(
          and(
            eq(wizardFeedMappings.userId, userId),
            eq(wizardFeedMappings.type, type),
            eq(wizardFeedMappings.firstRowHash, firstRowHash)
          )
        )
        .orderBy(desc(wizardFeedMappings.updatedAt))
        .limit(1);
      
      return mapping || undefined;
    },

    async create(insertMapping: InsertWizardFeedMapping): Promise<WizardFeedMapping> {
      const [mapping] = await db
        .insert(wizardFeedMappings)
        .values(insertMapping)
        .returning();
      return mapping;
    },

    async update(
      id: string, 
      updates: Partial<Omit<InsertWizardFeedMapping, 'id'>>
    ): Promise<WizardFeedMapping | undefined> {
      const [mapping] = await db
        .update(wizardFeedMappings)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(wizardFeedMappings.id, id))
        .returning();
      return mapping || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db
        .delete(wizardFeedMappings)
        .where(eq(wizardFeedMappings.id, id))
        .returning();
      return result.length > 0;
    },

    async listByUser(userId: string, type?: string): Promise<WizardFeedMapping[]> {
      const conditions = [eq(wizardFeedMappings.userId, userId)];
      
      if (type) {
        conditions.push(eq(wizardFeedMappings.type, type));
      }

      return db
        .select()
        .from(wizardFeedMappings)
        .where(and(...conditions))
        .orderBy(desc(wizardFeedMappings.updatedAt));
    },
  };
}
