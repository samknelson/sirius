import type { Express } from "express";
import { storage } from "../storage";
import { 
  TERMINOLOGY_VARIABLE_NAME, 
  terminologySchema, 
  mergeTerminology,
  getDefaultTerminology,
  TERM_REGISTRY,
  type TerminologyDictionary 
} from "@shared/terminology";

// Reads and writes of the site_terminology variable now go through the
// generic variable routes (GET/PUT/DELETE /api/variables/by-name/
// site_terminology), governed by the variable registry, which also runs
// the cache-invalidation hook after writes.

let terminologyCache: TerminologyDictionary | null = null;

export async function loadTerminology(): Promise<TerminologyDictionary> {
  const variable = await storage.variables.getByName(TERMINOLOGY_VARIABLE_NAME);
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
  
  terminologyCache = mergeTerminology(customTerms);
  return terminologyCache;
}

export function getCachedTerminology(): TerminologyDictionary {
  return terminologyCache || getDefaultTerminology();
}

export function invalidateTerminologyCache(): void {
  terminologyCache = null;
}

export function registerTerminologyRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any
) {
  // Reads go through GET /api/variables/by-name/site_terminology (public in
  // the variable read-access registry); the client merges shared defaults.

  app.get("/api/terminology/registry", requireAuth, async (req, res) => {
    try {
      res.json({ registry: TERM_REGISTRY });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch term registry" });
    }
  });

}
