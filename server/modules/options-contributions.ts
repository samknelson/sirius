import {
  optionsMetadata,
  type FieldDefinition,
  type OptionsTableMetadata,
  type OptionsTypeName,
} from "../storage/unified-options";

/**
 * A component's addition to the options framework: extra fields on an
 * existing list, a validator, or — with `definition` — a whole list of its
 * own. A component declaring a list also adds its type name to
 * `OptionsTypeNames` by interface augmentation.
 */
interface OptionsContribution {
  id: string;
  type: OptionsTypeName;
  definition?: OptionsTableMetadata<any>;
  fields?: FieldDefinition[];
  validate?: (data: unknown) => string | null | Promise<string | null>;
  /** Refuse deleting a row the component references without a foreign key. */
  deleteGuard?: (id: string) => Promise<{ status: number; message: string } | null>;
}
const contributions = new Map<string, OptionsContribution>();
const declaredFields = new Map<OptionsTypeName, Set<string>>();

/** Serve a list's own fields plus every contribution's, resolved on read. */
function installFields(type: OptionsTypeName, metadata: OptionsTableMetadata<any>): void {
  const ownFields = metadata.fields;
  declaredFields.set(type, new Set(ownFields.map(field => field.name)));
  Object.defineProperty(metadata, "fields", {
    enumerable: true,
    get() {
      const fields = [...ownFields, ...getContributedOptionsFields(type)];
      if (new Set(fields.map(field => field.name)).size !== fields.length) {
        throw new Error(`Duplicate options field in ${type}`);
      }
      return fields;
    },
  });
}
for (const [type, metadata] of Object.entries(optionsMetadata)) installFields(type as OptionsTypeName, metadata);

export function registerOptionsContribution(contribution: OptionsContribution): void {
  if (contributions.has(contribution.id)) throw new Error(`Duplicate options contribution: ${contribution.id}`);
  if (contribution.definition) {
    if (optionsMetadata[contribution.type]) throw new Error(`Duplicate options type: ${contribution.type}`);
    installFields(contribution.type, contribution.definition);
    optionsMetadata[contribution.type] = contribution.definition;
  }
  const names = new Set<string>();
  for (const field of contribution.fields ?? []) {
    if (names.has(field.name) || declaredFields.get(contribution.type)?.has(field.name) || [...contributions.values()].some(c => c.type === contribution.type && c.fields?.some(f => f.name === field.name))) {
      throw new Error(`Duplicate contributed options field: ${contribution.type}.${field.name}`);
    }
    names.add(field.name);
  }
  contributions.set(contribution.id, contribution);
}
export function getContributedOptionsFields(type: OptionsTypeName): FieldDefinition[] {
  return [...contributions.values()].filter(c => c.type === type).flatMap(c => c.fields ?? []);
}
export async function validateContributedOptionsData(type: string, data: unknown): Promise<string | null> {
  for (const contribution of contributions.values()) {
    if (contribution.type !== type || !contribution.validate) continue;
    const error = await contribution.validate(data);
    if (error) return error;
  }
  return null;
}
export async function checkContributedOptionsDelete(
  type: string,
  id: string,
): Promise<{ status: number; message: string } | null> {
  for (const contribution of contributions.values()) {
    if (contribution.type !== type || !contribution.deleteGuard) continue;
    const refusal = await contribution.deleteGuard(id);
    if (refusal) return refusal;
  }
  return null;
}
