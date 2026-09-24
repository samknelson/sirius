import { z } from "zod";
// Type-only, and from the types module rather than the package barrel, so this
// stays a compile-time link: nothing here pulls the catalog framework onto the
// boot path that imports this file.
import type { CatalogDetail } from "./catalog/types";

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
  worker: {
    key: "worker",
    label: "Worker",
    description: "Individual employees or members (e.g., Worker, Member, Employee)",
    defaults: {
      singular: "Worker",
      plural: "Workers",
    },
  },
  employer: {
    key: "employer",
    label: "Employer",
    description: "Organizations that employ workers (e.g., Employer, School, Company)",
    defaults: {
      singular: "Employer",
      plural: "Employers",
    },
  },
  seniorityDate: {
    key: "seniorityDate",
    label: "Seniority Date",
    description: "The date used to rank workers for dispatch ordering (formerly shown as \"Last Offer Date\")",
    defaults: {
      singular: "Seniority Date",
      plural: "Seniority Dates",
    },
  },
};

export const TERMINOLOGY_VARIABLE_NAME = "site_terminology";

/**
 * The default wording, as the terminology catalog carries it.
 *
 * A catalog's detail payload is a loosely typed bag of JSON values, so the
 * declaration that writes these fields and the screen that reads them back
 * would otherwise agree only by convention: rename one side and both halves
 * still typecheck while the screen quietly shows blank defaults. The field
 * names are written once, here, and both directions go through the two
 * functions below — so a rename is a type error rather than something a person
 * has to notice.
 *
 * A type alias rather than an interface on purpose: an interface carries no
 * implicit index signature and so would not satisfy the framework's
 * `CatalogDetail`.
 *
 * Two flat strings rather than a nested object, matching how the options
 * catalog carries its extra fields.
 */
export type TermDefaultsDetail = {
  defaultSingular: string;
  defaultPlural: string;
};

/** The detail payload one terminology catalog entry carries. */
export function termDefaultsDetail(defaults: TermForm): TermDefaultsDetail {
  return { defaultSingular: defaults.singular, defaultPlural: defaults.plural };
}

/**
 * The default wording from a terminology catalog entry, or `undefined` when the
 * entry does not carry it.
 *
 * Unreachable while both directions go through this file. It is handled rather
 * than asserted because the alternative failure is the one worth avoiding: a
 * screen confidently displaying "Default:" followed by nothing.
 */
export function readTermDefaults(
  detail: CatalogDetail | undefined,
): TermForm | undefined {
  if (!detail) return undefined;
  const { defaultSingular, defaultPlural } = detail as Partial<TermDefaultsDetail>;
  if (typeof defaultSingular !== "string" || typeof defaultPlural !== "string") {
    return undefined;
  }
  return { singular: defaultSingular, plural: defaultPlural };
}

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
