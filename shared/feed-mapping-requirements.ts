export interface RequiredFieldGroup {
  fieldIds: string[];
  message: string;
}

/** A group means at least one of its fields, not every field in the group. */
export function missingMappingGroups(
  mapping: Record<string, string>, groups: RequiredFieldGroup[] = [],
) {
  const keys = Object.keys(mapping);
  const legacy = keys.length > 0 && keys.every(key => key.startsWith("col_"));
  const mapped = new Set(legacy
    ? Object.values(mapping).filter(value => value && value !== "_unmapped")
    : keys.filter(key => mapping[key] && mapping[key] !== "_unmapped"));
  return groups.filter(group => !group.fieldIds.some(id => mapped.has(id)));
}
