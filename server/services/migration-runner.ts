import { storage } from "../storage";
import { logger } from "../logger";

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: () => Promise<void>;
}

const MIGRATIONS_VARIABLE_NAME = "migrations_version";

let registeredMigrations: Migration[] = [];

export function registerMigration(migration: Migration): void {
  registeredMigrations.push(migration);
  registeredMigrations.sort((a, b) => a.version - b.version);
}

export function getMigrations(): Migration[] {
  return [...registeredMigrations];
}

async function getCurrentVersion(): Promise<number> {
  const variable = await storage.variables.getByName(MIGRATIONS_VARIABLE_NAME);
  if (variable && typeof variable.value === "number") {
    return variable.value;
  }
  return 0;
}

async function setCurrentVersion(version: number): Promise<void> {
  const existingVariable = await storage.variables.getByName(MIGRATIONS_VARIABLE_NAME);
  
  if (existingVariable) {
    await storage.variables.update(existingVariable.id, {
      name: MIGRATIONS_VARIABLE_NAME,
      value: version
    });
  } else {
    await storage.variables.create({
      name: MIGRATIONS_VARIABLE_NAME,
      value: version
    });
  }
}

export async function runMigrations(): Promise<{ ran: number; skipped: number; errors: string[] }> {
  const currentVersion = await getCurrentVersion();
  const pendingMigrations = registeredMigrations.filter(m => m.version > currentVersion);
  
  if (pendingMigrations.length === 0) {
    logger.debug("No pending migrations", { 
      service: "migration-runner",
      currentVersion 
    });
    return { ran: 0, skipped: registeredMigrations.length, errors: [] };
  }

  logger.info("Starting migrations", {
    service: "migration-runner",
    currentVersion,
    pendingCount: pendingMigrations.length
  });

  let ran = 0;
  const errors: string[] = [];

  for (const migration of pendingMigrations) {
    try {
      logger.info(`Running migration ${migration.version}: ${migration.name}`, {
        service: "migration-runner",
        version: migration.version,
        name: migration.name
      });
      
      await migration.up();
      await setCurrentVersion(migration.version);
      ran++;
      
      logger.info(`Migration ${migration.version} completed successfully`, {
        service: "migration-runner",
        version: migration.version,
        name: migration.name
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Migration ${migration.version} (${migration.name}) failed: ${errorMessage}`);
      
      logger.error(`Migration ${migration.version} failed`, {
        service: "migration-runner",
        version: migration.version,
        name: migration.name,
        error: errorMessage
      });
      
      break;
    }
  }

  return { 
    ran, 
    skipped: registeredMigrations.length - pendingMigrations.length,
    errors 
  };
}

export async function getMigrationStatus(): Promise<{
  currentVersion: number;
  totalMigrations: number;
  pendingMigrations: Migration[];
}> {
  const currentVersion = await getCurrentVersion();
  const pendingMigrations = registeredMigrations.filter(m => m.version > currentVersion);
  
  return {
    currentVersion,
    totalMigrations: registeredMigrations.length,
    pendingMigrations
  };
}
