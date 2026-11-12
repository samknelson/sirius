import { createNoopValidator } from "./utils/validation";
import { getClient, runInTransaction, type TransactionClient } from "./transaction-context";
import { eq, asc, getTableName } from "drizzle-orm";
import { defineLoggingConfig, withStorageLogging } from "./middleware/logging";
import { optionsMetadata, type OptionsTypeName } from "./options-declarations";
import { fieldsToJsonSchema, resolveFieldChoices, type OptionsResourceDefinition } from "./options-definition";
export * from "./options-definition";
export type { OptionsTypeName, OptionsMetadataMap } from "./options-declarations";

export const validate = createNoopValidator();

export interface UnifiedOptionsStorage {
  list(type: OptionsTypeName): Promise<any[]>;
  get(type: OptionsTypeName, id: string): Promise<any | undefined>;
  create(type: OptionsTypeName, data: Record<string, any>): Promise<any>;
  update(type: OptionsTypeName, id: string, data: Record<string, any>): Promise<any | undefined>;
  delete(type: OptionsTypeName, id: string): Promise<boolean>;
  getMetadata(type: OptionsTypeName): typeof optionsMetadata[OptionsTypeName] | undefined;
  getDefinition(type: OptionsTypeName): OptionsResourceDefinition | undefined;
  getAllDefinitions(): OptionsResourceDefinition[];
  getAllTypes(): OptionsTypeName[];
}

function getTable(type: OptionsTypeName) {
  const metadata = optionsMetadata[type];
  if (!metadata) {
    throw new Error(`Unknown options type: ${type}`);
  }
  return metadata;
}

function createUnifiedOptionsStorageImpl(): UnifiedOptionsStorage {
  return {
    async list(type: OptionsTypeName): Promise<any[]> {
      const client = getClient();
      const { table, orderByColumn } = getTable(type);
      const tableAny = table as any;

      if (orderByColumn && tableAny[orderByColumn]) {
        return client.select().from(table).orderBy(asc(tableAny[orderByColumn]));
      }
      return client.select().from(table);
    },

    async get(type: OptionsTypeName, id: string): Promise<any | undefined> {
      const client = getClient();
      const { table } = getTable(type);
      const tableAny = table as any;
      const [result] = await client.select().from(table).where(eq(tableAny.id, id));
      return result || undefined;
    },

    async create(type: OptionsTypeName, data: Record<string, any>): Promise<any> {
      validate.validateOrThrow(type);
      const metadata = getTable(type);
      const write = async () => {
        if (metadata.beforeWrite) {
          await metadata.beforeWrite({ operation: "create", values: data, client: getClient() as TransactionClient });
        }
        if (metadata.writeSchema) data = metadata.writeSchema.parse(data);

        if (metadata.supportsParent && data.parent) {
          const allItems = await this.list(type);
          const parentExists = allItems.some((item: any) => item.id === data.parent);
          if (!parentExists) {
            throw new Error("Parent does not exist");
          }
        }

        const client = getClient();
        const { table } = getTable(type);
        const [result] = (await client.insert(table as any).values(data as any).returning()) as any[];
        return result;
      };
      return metadata.beforeWrite ? runInTransaction(write) : write();
    },

    async update(type: OptionsTypeName, id: string, data: Record<string, any>): Promise<any | undefined> {
      validate.validateOrThrow(type);
      const metadata = getTable(type);
      const write = async () => {
        if (metadata.beforeWrite) {
          await metadata.beforeWrite({ operation: "update", id, values: data, client: getClient() as TransactionClient });
        }
        if (metadata.writeSchema) data = metadata.writeSchema.partial().parse(data);

        if (metadata.supportsParent && data.parent !== undefined) {
          if (data.parent === id) {
            throw new Error("An item cannot be its own parent");
          }

          if (data.parent !== null) {
            const allItems = await this.list(type);
            const parentExists = allItems.some((item: any) => item.id === data.parent);
            if (!parentExists) {
              throw new Error("Parent does not exist");
            }

            const wouldCreateCycle = (targetId: string, newParentId: string): boolean => {
              const itemMap = new Map(allItems.map((item: any) => [item.id, item]));
              itemMap.set(targetId, { ...itemMap.get(targetId), parent: newParentId });

              let current = newParentId;
              const visited = new Set<string>();
              while (current) {
                if (visited.has(current)) return true;
                if (current === targetId) return true;
                visited.add(current);
                const item = itemMap.get(current);
                current = item?.parent || null;
              }
              return false;
            };

          if (wouldCreateCycle(id, data.parent)) {
            throw new Error("This change would create a circular reference");
          }
        }
      }

      const client = getClient();
      const { table } = metadata;
      const tableAny = table as any;
      const [result] = await client
        .update(table)
        .set(data as any)
        .where(eq(tableAny.id, id))
        .returning();
      return result || undefined;
      };
      return metadata.beforeWrite ? runInTransaction(write) : write();
    },

    async delete(type: OptionsTypeName, id: string): Promise<boolean> {
      const client = getClient();
      const { table } = getTable(type);
      const tableAny = table as any;
      const result = (await client.delete(tableAny).where(eq(tableAny.id, id)).returning()) as any[];
      return result.length > 0;
    },

    getMetadata(type: OptionsTypeName) {
      return optionsMetadata[type];
    },

    getDefinition(type: OptionsTypeName): OptionsResourceDefinition | undefined {
      const metadata = optionsMetadata[type];
      if (!metadata) return undefined;
      const fields = resolveFieldChoices(metadata.fields);
      const { schema, uiSchema } = fieldsToJsonSchema(fields);
      return {
        type,
        displayName: metadata.displayName,
        description: metadata.description,
        singularName: metadata.singularName,
        pluralName: metadata.pluralName,
        fields,
        schema,
        uiSchema,
        supportsSequencing: metadata.supportsSequencing ?? false,
        supportsParent: metadata.supportsParent ?? false,
        requiredComponent: metadata.requiredComponent,
      };
    },

    getAllDefinitions(): OptionsResourceDefinition[] {
      return (Object.keys(optionsMetadata) as OptionsTypeName[]).map(type => {
        const metadata = optionsMetadata[type];
        const fields = resolveFieldChoices(metadata.fields);
        const { schema, uiSchema } = fieldsToJsonSchema(fields);
        return {
          type,
          displayName: metadata.displayName,
          description: metadata.description,
          singularName: metadata.singularName,
          pluralName: metadata.pluralName,
          fields,
          schema,
          uiSchema,
          supportsSequencing: metadata.supportsSequencing ?? false,
          supportsParent: metadata.supportsParent ?? false,
          requiredComponent: metadata.requiredComponent,
        };
      });
    },

    getAllTypes(): OptionsTypeName[] {
      return Object.keys(optionsMetadata) as OptionsTypeName[];
    },
  };
}

export const unifiedOptionsLoggingConfig = defineLoggingConfig<UnifiedOptionsStorage>({
  module: "options",
  // One storage over every options table: the type argument names which.
  table: (args) => {
    const metadata = optionsMetadata[args[0] as OptionsTypeName];
    return metadata ? getTableName(metadata.table) : undefined;
  },
  methods: {
    create: {
      getEntityId: (args) => args[1]?.name || `new ${args[0]}`,
      metadataEntityId: (_args, result) => result?.id,
    },
    update: {
      getEntityId: (args) => args[1],
      before: async (args, storage) =>
        storage.get(args[0] as OptionsTypeName, args[1] as string),
    },
    delete: {
      getEntityId: (args) => args[1],
      before: async (args, storage) =>
        storage.get(args[0] as OptionsTypeName, args[1] as string),
    },
  },
});

export function createUnifiedOptionsStorage(): UnifiedOptionsStorage {
  // Wrapped so every option row written through this storage — by hand on
  // the List tab or in bulk by the JSON importer — lands in the admin log
  // viewer as its own entry. `withStorageLogging` invokes the underlying
  // method with `this` bound to the unwrapped implementation, so internal
  // `this.list()` / `this.get()` calls are unaffected.
  return withStorageLogging(createUnifiedOptionsStorageImpl(), unifiedOptionsLoggingConfig);
}

/**
 * `optionsMetadata` is the one place an options list is declared, and its keys
 * are the one list of what exists. Two things project it and neither is
 * downstream of the other: the type registry in ../modules/options-registry.ts
 * builds a config per key, and ./unified-options-catalog.ts publishes the
 * descriptive half as the `options-lists` shared catalog.
 */
export { optionsMetadata };
