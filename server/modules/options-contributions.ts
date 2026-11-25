import type { FieldDefinition, OptionsTypeName } from "../storage/unified-options";

interface OptionsContribution {
  id: string;
  type: OptionsTypeName;
  fields?: FieldDefinition[];
  validate?: (data: unknown) => string | null | Promise<string | null>;
}
const contributions = new Map<string, OptionsContribution>();
const coreFields = new Map<OptionsTypeName, Set<string>>();
export function declareCoreOptionsFields(type: OptionsTypeName, fields: FieldDefinition[]): void {
  coreFields.set(type, new Set(fields.map(field => field.name)));
}
export function registerOptionsContribution(contribution: OptionsContribution): void {
  if (contributions.has(contribution.id)) throw new Error(`Duplicate options contribution: ${contribution.id}`);
  const names = new Set<string>();
  for (const field of contribution.fields ?? []) {
    if (names.has(field.name) || coreFields.get(contribution.type)?.has(field.name) || [...contributions.values()].some(c => c.type === contribution.type && c.fields?.some(f => f.name === field.name))) {
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
