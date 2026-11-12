export interface BenefitFieldConfig {
  fieldId: string;
  benefitId: string;
  benefitName?: string;
}

export interface BenefitField {
  id: string;
  type?: string;
  isBenefitEligibility?: boolean;
}

export const REQUIRED_BENEFIT_MAPPING_MESSAGE =
  "Map at least one uploaded column to a Benefit Eligibility field before continuing.";

/** Both mapping orientations remain valid for previously saved uploads. */
export function mappedBenefitFieldIds(fields: BenefitField[], mapping: Record<string, string> = {}) {
  const keys = Object.keys(mapping);
  const legacy = keys.length > 0 && keys.every(key => key.startsWith("col_"));
  const mapped = new Set(legacy
    ? Object.values(mapping).filter(value => value && value !== "_unmapped")
    : keys.filter(key => mapping[key] && mapping[key] !== "_unmapped"));
  return fields.filter(field => field.type === "benefit" && field.isBenefitEligibility && mapped.has(field.id))
    .map(field => field.id);
}

/** Exact coverage prevents an old association from satisfying a new mapping. */
export function benefitConfigurationError(
  mappedIds: string[], value: unknown, validBenefitIds?: ReadonlySet<string>,
): string | undefined {
  if (!mappedIds.length) return REQUIRED_BENEFIT_MAPPING_MESSAGE;
  if (!Array.isArray(value)) return "Choose and save a trust benefit for every mapped Benefit Eligibility field.";
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row.fieldId !== "string" || !mappedIds.includes(row.fieldId)) {
      return "Benefit configuration contains a field that is no longer mapped. Review and save the Benefits step.";
    }
    if (seen.has(row.fieldId)) return `Choose only one trust benefit for ${row.fieldId}.`;
    seen.add(row.fieldId);
    if (typeof row.benefitId !== "string" || !row.benefitId.trim() ||
        row.benefitId === "_none" || (validBenefitIds && !validBenefitIds.has(row.benefitId))) {
      return `Choose an available active trust benefit for ${row.fieldId}.`;
    }
  }
  if (mappedIds.some(id => !seen.has(id))) return "Choose and save a trust benefit for every mapped Benefit Eligibility field.";
}

export interface GbhetBenefitSetup {
  fields: Array<BenefitField & { name: string; required: boolean; description?: string }>;
  benefits: Array<{ id: string; name: string; isActive: boolean; benefitTypeName?: string | null }>;
  defaultBenefit: { id: string; name: string } | null;
  defaultBenefitWarning: string | null;
  configurationError?: string;
}
