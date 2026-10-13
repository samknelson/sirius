import { createNoopValidator } from '../utils/validation';
import { getClient, onAfterCommit } from '../transaction-context';
import { notifyLocalConfigurationCommit } from "../../services/configuration-cache-registry";
import { variables, type Variable, type InsertVariable } from "@shared/schema";
import { eq, like, sql } from "drizzle-orm";
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

function committed(): void {
  onAfterCommit(notifyLocalConfigurationCommit);
}

export interface VariableStorage {
  getAll(): Promise<Variable[]>;
  get(id: string): Promise<Variable | undefined>;
  getByName(name: string): Promise<Variable | undefined>;
  getJsonState(name: string): Promise<{ value: unknown; version: string } | undefined>;
  getByNamePrefix(prefix: string): Promise<Variable[]>;
  create(variable: InsertVariable): Promise<Variable>;
  update(id: string, variable: Partial<InsertVariable>): Promise<Variable | undefined>;
  upsertJsonBooleanKey(name: string, key: string, value: boolean): Promise<Variable>;
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
    async getJsonState(name) {
      const [state] = await getClient().select({
        value: variables.value,
        // Compare for equality only: detects same-value lifecycle/config repairs too.
        version: sql<string>`${variables}.xmin::text`,
      }).from(variables).where(eq(variables.name, name));
      return state;
    },

    async create(insertVariable: InsertVariable): Promise<Variable> {
      validate.validateOrThrow(insertVariable);
      const client = getClient();
      const [variable] = await client
        .insert(variables)
        .values(insertVariable)
        .returning();
      committed();
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
      
      if (variable) committed();
      return variable || undefined;
    },

    async upsertJsonBooleanKey(name, key, value) {
      const patch = JSON.stringify({ [key]: value });
      const [variable] = await getClient().insert(variables)
        .values({ name, value: { [key]: value } })
        .onConflictDoUpdate({
          target: variables.name,
          set: { value: sql`coalesce(${variables.value}, '{}'::jsonb) || ${patch}::jsonb` },
          // Refuse malformed legacy data rather than erasing it or making an array.
          setWhere: sql`${variables.value} is null or jsonb_typeof(${variables.value}) = 'object'`,
        }).returning();
      if (!variable) throw new Error(`Variable "${name}" must contain a JSON object`);
      committed();
      return variable;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(variables).where(eq(variables.id, id)).returning();
      if (result.length) committed();
      return result.length > 0;
    },

    async deleteByNamePrefix(prefix: string): Promise<number> {
      const client = getClient();
      const result = await client
        .delete(variables)
        .where(like(variables.name, `${escapeLikePrefix(prefix)}%`))
        .returning();
      if (result.length) committed();
      return result.length;
    }
  };
}

export const variableLoggingConfig = defineLoggingConfig<VariableStorage>({
  module: 'variables',
  table: 'variables',
  methods: {
    create: { getEntityId: (args) => args[0]?.name },
    update: {},
    upsertJsonBooleanKey: {
      getEntityId: (_args, result) => result?.id,
      getDescription: (args) => `Updated ${args[0]} flag ${args[1]} to ${args[2]}`,
    },
    delete: {},
  },
});
