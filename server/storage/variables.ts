import { db } from "../db";
import { variables, type Variable, type InsertVariable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface VariableStorage {
  getAll(): Promise<Variable[]>;
  get(id: string): Promise<Variable | undefined>;
  getByName(name: string): Promise<Variable | undefined>;
  create(variable: InsertVariable): Promise<Variable>;
  update(id: string, variable: Partial<InsertVariable>): Promise<Variable | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createVariableStorage(): VariableStorage {
  return {
    async getAll(): Promise<Variable[]> {
      const allVariables = await db.select().from(variables);
      return allVariables.sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(id: string): Promise<Variable | undefined> {
      const [variable] = await db.select().from(variables).where(eq(variables.id, id));
      return variable || undefined;
    },

    async getByName(name: string): Promise<Variable | undefined> {
      const [variable] = await db.select().from(variables).where(eq(variables.name, name));
      return variable || undefined;
    },

    async create(insertVariable: InsertVariable): Promise<Variable> {
      const [variable] = await db
        .insert(variables)
        .values(insertVariable)
        .returning();
      return variable;
    },

    async update(id: string, variableUpdate: Partial<InsertVariable>): Promise<Variable | undefined> {
      const [variable] = await db
        .update(variables)
        .set(variableUpdate)
        .where(eq(variables.id, id))
        .returning();
      
      return variable || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(variables).where(eq(variables.id, id)).returning();
      return result.length > 0;
    }
  };
}

export const variableLoggingConfig: StorageLoggingConfig<VariableStorage> = {
  module: 'variables',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.name,
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
