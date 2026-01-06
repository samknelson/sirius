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
  app.get("/api/terminology", async (req, res) => {
    try {
      const terminology = await loadTerminology();
      res.json({ terminology });
    } catch (error) {
      console.error("Failed to fetch terminology:", error);
      res.status(500).json({ message: "Failed to fetch terminology" });
    }
  });

  app.get("/api/terminology/registry", requireAuth, async (req, res) => {
    try {
      res.json({ registry: TERM_REGISTRY });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch term registry" });
    }
  });

  app.put("/api/terminology", requireAccess('admin'), async (req, res) => {
    try {
      const { terminology } = req.body;
      
      if (!terminology || typeof terminology !== 'object') {
        res.status(400).json({ message: "Invalid terminology data" });
        return;
      }

      const validTerms: Partial<TerminologyDictionary> = {};
      for (const [key, value] of Object.entries(terminology)) {
        if (key in TERM_REGISTRY && value && typeof value === 'object') {
          const term = value as any;
          if (term.singular && term.plural) {
            validTerms[key] = {
              singular: String(term.singular).trim(),
              plural: String(term.plural).trim(),
            };
          }
        }
      }

      const existingVariable = await storage.variables.getByName(TERMINOLOGY_VARIABLE_NAME);
      
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { 
          value: JSON.stringify(validTerms) 
        });
      } else {
        await storage.variables.create({ 
          name: TERMINOLOGY_VARIABLE_NAME, 
          value: JSON.stringify(validTerms) 
        });
      }

      invalidateTerminologyCache();
      const updatedTerminology = await loadTerminology();
      
      res.json({ terminology: updatedTerminology });
    } catch (error) {
      console.error("Failed to update terminology:", error);
      res.status(500).json({ message: "Failed to update terminology" });
    }
  });

  app.post("/api/terminology/reset", requireAccess('admin'), async (req, res) => {
    try {
      const existingVariable = await storage.variables.getByName(TERMINOLOGY_VARIABLE_NAME);
      
      if (existingVariable) {
        await storage.variables.delete(existingVariable.id);
      }

      invalidateTerminologyCache();
      const defaultTerminology = getDefaultTerminology();
      
      res.json({ terminology: defaultTerminology });
    } catch (error) {
      console.error("Failed to reset terminology:", error);
      res.status(500).json({ message: "Failed to reset terminology" });
    }
  });
}
