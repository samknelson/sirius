import { storage } from "../storage";
import { readConfigurationSnapshot } from "../storage/configuration-revisions";
import { 
  TERMINOLOGY_VARIABLE_NAME, 
  terminologySchema, 
  mergeTerminology,
  getDefaultTerminology,
  type TerminologyDictionary 
} from "@shared/terminology";

// This module registers no routes. Reads and writes of the site_terminology
// variable go through the generic variable routes (GET/PUT/DELETE
// /api/variables/by-name/site_terminology), governed by the variable registry,
// which also runs the cache-invalidation hook after writes. What terms exist is
// the `terminology` catalog, declared in ./terminology-catalog.ts.

let terminologyCache: TerminologyDictionary | null = null;
let generation = 0;

export async function loadTerminology(): Promise<TerminologyDictionary> {
  const current = ++generation;
  const variable = await readConfigurationSnapshot(() => storage.variables.getByName(TERMINOLOGY_VARIABLE_NAME));
  let customTerms: Partial<TerminologyDictionary> | null = null;
  
  if (variable && variable.value) {
    try {
      const parsed = typeof variable.value === 'string' 
        ? JSON.parse(variable.value) 
        : variable.value;
      const result = terminologySchema.safeParse(parsed);
      if (result.success) {
        customTerms = result.data;
      }
    } catch (e) {
      console.warn("Invalid terminology data in variables, using defaults");
    }
  }
  
  const loaded = mergeTerminology(customTerms);
  if (current === generation) terminologyCache = loaded;
  return getCachedTerminology();
}

export function getCachedTerminology(): TerminologyDictionary {
  return terminologyCache || getDefaultTerminology();
}

export function invalidateTerminologyCache(): void {
  // Keep the last confirmed dictionary during an outage, but reject old loads.
  generation++;
}
