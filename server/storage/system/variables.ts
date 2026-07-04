import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { variables, type Variable, type InsertVariable } from "@shared/schema";
import { eq, like } from "drizzle-orm";
import { defineLoggingConfig, type StorageLoggingConfig } from "../middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

/**
 * Escapes LIKE wildcard metacharacters (`%`, `_`) and the escape character
 * (`\`) so a prefix is matched literally. PostgreSQL's default LIKE escape
 * character is the backslash, so no explicit ESCAPE clause is required.
 */
function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface VariableStorage {
  getAll(): Promise<Variable[]>;
  get(id: string): Promise<Variable | undefined>;
  getByName(name: string): Promise<Variable | undefined>;
  getByNamePrefix(prefix: string): Promise<Variable[]>;
  create(variable: InsertVariable): Promise<Variable>;
  update(id: string, variable: Partial<InsertVariable>): Promise<Variable | undefined>;
  delete(id: string): Promise<boolean>;
  deleteByNamePrefix(prefix: string): Promise<number>;
}

export function createVariableStorage(): VariableStorage {
  return {
    async getAll(): Promise<Variable[]> {
      const client = getClient();
      const allVariables = await client.select().from(variables);
      return allVariables.sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(id: string): Promise<Variable | undefined> {
      const client = getClient();
      const [variable] = await client.select().from(variables).where(eq(variables.id, id));
      return variable || undefined;
    },

    async getByName(name: string): Promise<Variable | undefined> {
      const client = getClient();
      const [variable] = await client.select().from(variables).where(eq(variables.name, name));
      return variable || undefined;
    },

    async getByNamePrefix(prefix: string): Promise<Variable[]> {
      const client = getClient();
      return client.select().from(variables).where(like(variables.name, `${escapeLikePrefix(prefix)}%`));
    },

    async create(insertVariable: InsertVariable): Promise<Variable> {
      validate.validateOrThrow(insertVariable);
      const client = getClient();
      const [variable] = await client
        .insert(variables)
        .values(insertVariable)
        .returning();
      return variable;
    },

    async update(id: string, variableUpdate: Partial<InsertVariable>): Promise<Variable | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [variable] = await client
        .update(variables)
        .set(variableUpdate)
        .where(eq(variables.id, id))
        .returning();
      
      return variable || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(variables).where(eq(variables.id, id)).returning();
      return result.length > 0;
    },

    async deleteByNamePrefix(prefix: string): Promise<number> {
      const client = getClient();
      const result = await client
        .delete(variables)
        .where(like(variables.name, `${escapeLikePrefix(prefix)}%`))
        .returning();
      return result.length;
    }
  };
}

export const variableLoggingConfig = defineLoggingConfig<VariableStorage>({
  module: 'variables',
  methods: {
    create: { getEntityId: (args) => args[0]?.name },
    update: {},
    delete: {},
  },
});
