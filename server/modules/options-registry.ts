import { 
  createUnifiedOptionsStorage, 
  type UnifiedOptionsStorage,
  type OptionsTypeName,
  optionsMetadata,
  resolveFieldChoices,
} from "../storage/unified-options";

export interface OptionsTypeConfig {
  name: string;
  type: OptionsTypeName;
  getAll: () => Promise<any[]>;
  get: (id: string) => Promise<any | undefined>;
  create: (data: any) => Promise<any>;
  update: (id: string, data: any) => Promise<any | undefined>;
  delete: (id: string) => Promise<boolean>;
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  requiredComponent?: string;
  /**
   * Allowed values for single-value `enum` fields, keyed by field name.
   * Used by the write routes to reject values outside the fixed set
   * (the UI already constrains these via a select, but a direct API
   * call must not be able to persist an out-of-range value).
   *
   * A function, not a snapshot: choices may come from a registry that is
   * populated during boot, after this module is imported.
   */
  enumConstraints: () => Record<string, string[]>;
}

let unifiedStorage: UnifiedOptionsStorage | null = null;

function getUnifiedStorage(): UnifiedOptionsStorage {
  if (!unifiedStorage) {
    unifiedStorage = createUnifiedOptionsStorage();
  }
  return unifiedStorage;
}

function createTypeConfig(type: OptionsTypeName): OptionsTypeConfig {
  const storage = getUnifiedStorage();
  const metadata = optionsMetadata[type];

  // Resolved on ACCESS, not here: this registry is built when the module is
  // imported, and a field whose choices come from a registry populated during
  // boot would otherwise freeze an empty allow-list and reject every write.
  const enumConstraints = (): Record<string, string[]> => {
    const constraints: Record<string, string[]> = {};
    for (const field of resolveFieldChoices(metadata.fields)) {
      if (field.inputType === "enum" && field.enumOptions?.length) {
        constraints[field.name] = field.enumOptions.map((o) => o.value);
      }
    }
    return constraints;
  };

  return {
    name: metadata.displayName,
    type,
    getAll: () => storage.list(type),
    get: (id: string) => storage.get(type, id),
    create: (data: any) => storage.create(type, data),
    update: (id: string, data: any) => storage.update(type, id, data),
    delete: (id: string) => storage.delete(type, id),
    requiredFields: metadata.requiredFields,
    optionalFields: metadata.optionalFields,
    requiredComponent: metadata.requiredComponent,
    enumConstraints,
  };
}

/**
 * Every declared options list, keyed by type.
 *
 * The keys are `optionsMetadata`'s keys and are not written out again here.
 * They used to be: a hand-kept object literal of all 32 identifiers, sitting
 * beside the metadata that already named them, where adding a list meant
 * declaring it twice and forgetting the second one meant the list existed but
 * had no routes.
 */
export const optionsTypeRegistry: Record<string, OptionsTypeConfig> =
  Object.fromEntries(
    (Object.keys(optionsMetadata) as OptionsTypeName[]).map((type) => [
      type,
      createTypeConfig(type),
    ]),
  );

/**
 * The declared config for a type, or undefined if no such list is declared.
 *
 * Unfiltered by component state, and that is the point: a caller has to be able
 * to tell a list that is switched off from a list that does not exist. The
 * component gate on the options routes reads this, finds the `requiredComponent`
 * of a list it can see is real, and refuses it as disabled — where reading a
 * component-filtered source would have left the same list looking unknown.
 */
export function getOptionsType(type: string): OptionsTypeConfig | undefined {
  return optionsTypeRegistry[type];
}

export function getOptionsStorage(): UnifiedOptionsStorage {
  return getUnifiedStorage();
}
