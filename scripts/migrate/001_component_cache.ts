import { storage } from "../../server/storage";
import { getAllComponents } from "../../shared/components";
import { registerMigration, type Migration } from "../../server/services/migration-runner";
import { logger } from "../../server/logger";

const COMPONENTS_VARIABLE_NAME = "components";

async function up(): Promise<void> {
  const existingVariable = await storage.variables.getByName(COMPONENTS_VARIABLE_NAME);
  
  if (existingVariable) {
    logger.info("Components variable already exists, skipping consolidation", {
      service: "migration-001"
    });
  } else {
    const allComponents = getAllComponents();
    const componentState: Record<string, boolean> = {};
    const legacyVariablesToDelete: { id: string; name: string }[] = [];

    for (const component of allComponents) {
      const legacyVariableName = `component_${component.id}`;
      const legacyVariable = await storage.variables.getByName(legacyVariableName);
      
      if (legacyVariable) {
        componentState[component.id] = legacyVariable.value === true;
        legacyVariablesToDelete.push({ id: legacyVariable.id, name: legacyVariableName });
      }
    }

    if (Object.keys(componentState).length > 0) {
      await storage.variables.create({
        name: COMPONENTS_VARIABLE_NAME,
        value: componentState
      });
      
      logger.info("Created consolidated components variable", {
        service: "migration-001",
        componentCount: Object.keys(componentState).length
      });
    }
  }

  const allComponents = getAllComponents();
  let deletedCount = 0;
  
  for (const component of allComponents) {
    const legacyVariableName = `component_${component.id}`;
    const legacyVariable = await storage.variables.getByName(legacyVariableName);
    
    if (legacyVariable) {
      await storage.variables.delete(legacyVariable.id);
      deletedCount++;
      
      logger.debug(`Deleted legacy variable: ${legacyVariableName}`, {
        service: "migration-001"
      });
    }
  }

  if (deletedCount > 0) {
    logger.info("Cleaned up legacy component variables", {
      service: "migration-001",
      deletedCount
    });
  }
}

const migration: Migration = {
  version: 1,
  name: "component_cache",
  description: "Consolidate individual component_* variables into single 'components' JSON variable and clean up legacy variables",
  up
};

registerMigration(migration);

export default migration;
