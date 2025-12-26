import { z } from "zod";

export const termFormSchema = z.object({
  singular: z.string().min(1, "Singular form is required"),
  plural: z.string().min(1, "Plural form is required"),
});

export type TermForm = z.infer<typeof termFormSchema>;

export interface TermDefinition {
  key: string;
  label: string;
  description: string;
  defaults: TermForm;
}

export const terminologySchema = z.record(z.string(), termFormSchema);

export type TerminologyDictionary = z.infer<typeof terminologySchema>;

export const TERM_REGISTRY: Record<string, TermDefinition> = {
  steward: {
    key: "steward",
    label: "Steward",
    description: "Union representative assigned to workers (e.g., Shop Steward, Building Rep)",
    defaults: {
      singular: "Shop Steward",
      plural: "Shop Stewards",
    },
  },
};

export const TERMINOLOGY_VARIABLE_NAME = "site_terminology";

export function getDefaultTerminology(): TerminologyDictionary {
  const defaults: TerminologyDictionary = {};
  for (const [key, def] of Object.entries(TERM_REGISTRY)) {
    defaults[key] = { ...def.defaults };
  }
  return defaults;
}

export function mergeTerminology(
  customTerms: Partial<TerminologyDictionary> | null | undefined
): TerminologyDictionary {
  const defaults = getDefaultTerminology();
  if (!customTerms) return defaults;
  
  const merged: TerminologyDictionary = { ...defaults };
  for (const [key, form] of Object.entries(customTerms)) {
    if (key in TERM_REGISTRY && form) {
      merged[key] = {
        singular: form.singular || defaults[key].singular,
        plural: form.plural || defaults[key].plural,
      };
    }
  }
  return merged;
}

export type TermOptions = {
  plural?: boolean;
  count?: number;
  capitalize?: boolean;
  lowercase?: boolean;
};

export function resolveTerm(
  terminology: TerminologyDictionary,
  key: string,
  options: TermOptions = {}
): string {
  const term = terminology[key];
  if (!term) {
    console.warn(`Unknown term key: ${key}`);
    return key;
  }

  const usePlural = options.plural ?? (options.count !== undefined && options.count !== 1);
  let result = usePlural ? term.plural : term.singular;

  if (options.capitalize) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  } else if (options.lowercase) {
    result = result.toLowerCase();
  }

  return result;
}

export function createTermResolver(terminology: TerminologyDictionary) {
  return (key: string, options: TermOptions = {}): string => {
    return resolveTerm(terminology, key, options);
  };
}
