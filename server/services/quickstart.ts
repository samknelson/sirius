import { db } from "../db";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import fs from "fs/promises";
import path from "path";

export interface QuickstartMetadata {
  name: string;
  exportedAt: string;
  tableCounts: Record<string, number>;
  version: string;
  schemaVersion: string;
}

export interface QuickstartData {
  metadata: QuickstartMetadata;
  data: Record<string, any[]>;
}

// Current schema version for compatibility checking
// Bump this when adding new tables to ensure old exports are flagged as incompatible
const SCHEMA_VERSION = '1.1';

// Define table order for export/import (respects foreign key dependencies)
// Tables are ordered from least dependent to most dependent
const TABLE_ORDER = [
  // Level 1: No dependencies (options, roles, base entities)
  'variables',
  'roles',
  'users',
  'optionsGender',
  'optionsWorkerIdType',
  'optionsTrustBenefitType',
  'optionsLedgerPaymentType',
  'optionsEmployerContactType',
  'optionsWorkerWs',
  'optionsEmploymentStatus',
  'optionsTrustProviderType',
  'ledgerAccounts',
  'employers',
  'trustProviders',
  'cronJobs',
  
  // Level 2: Depends on level 1
  'contacts',
  'userRoles',
  'rolePermissions',
  'trustBenefits',
  'bookmarks',
  'ledgerStripePaymentMethods',
  'ledgerEa',
  'wizards',
  'chargePluginConfigs',
  'cronJobRuns',
  
  // Level 3: Depends on level 2
  'workers',
  'employerContacts',
  'trustProviderContacts',
  'postalAddresses',
  'phoneNumbers',
  'wizardEmployerMonthly',
  'wizardFeedMappings',
  'wizardReportData',
  'ledgerPayments',
  
  // Level 4: Depends on level 3
  'workerIds',
  'workerHours',
  'workerWsh',
  'trustWmb',
  'ledger',
] as const;

// Tables to exclude from export/import (runtime/audit data, or stored in object storage)
const EXCLUDED_TABLES = ['sessions', 'winstonLogs', 'files'];

const QUICKSTARTS_DIR = path.join(process.cwd(), 'database', 'quickstarts');

/**
 * Convert ISO date strings back to Date objects for Drizzle timestamp columns
 * Recursively processes objects and arrays
 */
function reviveDates(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    // Check if string matches ISO 8601 date format
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    if (isoDateRegex.test(obj)) {
      return new Date(obj);
    }
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => reviveDates(item));
  }
  
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = reviveDates(value);
    }
    return result;
  }
  
  return obj;
}

/**
 * Validate and sanitize quickstart name to prevent path traversal
 */
function validateQuickstartName(name: string): void {
  // Only allow alphanumeric, hyphens, and underscores
  const validNameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!validNameRegex.test(name)) {
    throw new Error('Invalid quickstart name. Use only letters, numbers, hyphens, and underscores.');
  }
  
  // Additional safety: ensure the resolved path stays within quickstarts directory
  const filename = `${name}.json`;
  const filepath = path.join(QUICKSTARTS_DIR, filename);
  const resolvedPath = path.resolve(filepath);
  const resolvedDir = path.resolve(QUICKSTARTS_DIR);
  
  if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
    throw new Error('Invalid quickstart name: path traversal detected.');
  }
}

/**
 * Validate quickstart data structure and version compatibility
 */
function validateQuickstartData(data: any): void {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid quickstart file format: not an object');
  }
  
  if (!data.metadata || !data.data) {
    throw new Error('Invalid quickstart file format: missing metadata or data');
  }
  
  if (data.metadata.schemaVersion !== SCHEMA_VERSION) {
    console.warn(`Schema version mismatch: file is ${data.metadata.schemaVersion}, current is ${SCHEMA_VERSION}. Missing tables will be skipped.`);
  }
  
  if (typeof data.data !== 'object') {
    throw new Error('Invalid quickstart file format: data is not an object');
  }
  
  // Check tables - warn about missing ones but don't fail (for backward compatibility)
  for (const tableName of TABLE_ORDER) {
    if (!(tableName in data.data)) {
      console.warn(`Quickstart file missing table "${tableName}" - will be skipped`);
      continue;
    }
    
    if (!Array.isArray(data.data[tableName])) {
      throw new Error(`Invalid quickstart file: table "${tableName}" is not an array`);
    }
  }
}

/**
 * Export current database state to a named quickstart file
 */
export async function exportQuickstart(name: string): Promise<QuickstartMetadata> {
  // Validate name to prevent path traversal
  validateQuickstartName(name);
  
  const data: Record<string, any[]> = {};
  const tableCounts: Record<string, number> = {};

  // Export each table in order
  for (const tableName of TABLE_ORDER) {
    const table = (schema as any)[tableName];
    if (!table) {
      console.warn(`Table ${tableName} not found in schema, skipping`);
      continue;
    }

    const rows = await db.select().from(table);
    data[tableName] = rows;
    tableCounts[tableName] = rows.length;
  }

  const metadata: QuickstartMetadata = {
    name,
    exportedAt: new Date().toISOString(),
    tableCounts,
    version: '1.0',
    schemaVersion: SCHEMA_VERSION,
  };

  const quickstartData: QuickstartData = {
    metadata,
    data,
  };

  // Ensure directory exists
  await fs.mkdir(QUICKSTARTS_DIR, { recursive: true });

  // Write to file
  const filename = `${name}.json`;
  const filepath = path.join(QUICKSTARTS_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(quickstartData, null, 2), 'utf-8');

  return metadata;
}

/**
 * Import a quickstart file, replacing all data in the database
 */
export async function importQuickstart(name: string): Promise<QuickstartMetadata> {
  // Validate name to prevent path traversal
  validateQuickstartName(name);
  
  const filename = `${name}.json`;
  const filepath = path.join(QUICKSTARTS_DIR, filename);

  // Read and parse file
  const fileContent = await fs.readFile(filepath, 'utf-8');
  const quickstartData: QuickstartData = JSON.parse(fileContent);

  // Validate the quickstart data
  validateQuickstartData(quickstartData);

  // Perform import in a transaction for complete rollback on error
  await db.transaction(async (tx) => {
    // Truncate all tables in reverse order (to respect foreign keys)
    // Use proper identifier quoting to prevent SQL injection
    for (let i = TABLE_ORDER.length - 1; i >= 0; i--) {
      const tableVarName = TABLE_ORDER[i];
      const table = (schema as any)[tableVarName];
      if (!table) {
        console.warn(`Table ${tableVarName} not found in schema, skipping truncate`);
        continue;
      }

      // Get the actual database table name from the Drizzle table object
      const { name: dbTableName } = getTableConfig(table);
      
      // Use parameterized identifier for safety with actual database table name
      await tx.execute(sql`TRUNCATE TABLE ${sql.identifier(dbTableName)} RESTART IDENTITY CASCADE`);
    }

    // Insert data in forward order
    for (const tableVarName of TABLE_ORDER) {
      const table = (schema as any)[tableVarName];
      if (!table) {
        console.warn(`Table ${tableVarName} not found in schema, skipping insert`);
        continue;
      }

      const rows = quickstartData.data[tableVarName] || [];
      if (rows.length === 0) continue;

      // Convert date strings back to Date objects for timestamp columns
      const processedRows = reviveDates(rows);

      // Insert all rows for this table
      // Drizzle handles parameter binding safely
      await tx.insert(table).values(processedRows);
    }
  });

  return quickstartData.metadata;
}

/**
 * List all available quickstart files
 */
export async function listQuickstarts(): Promise<QuickstartMetadata[]> {
  try {
    await fs.mkdir(QUICKSTARTS_DIR, { recursive: true });
    const files = await fs.readdir(QUICKSTARTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const quickstarts: QuickstartMetadata[] = [];

    for (const file of jsonFiles) {
      const filepath = path.join(QUICKSTARTS_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      const data: QuickstartData = JSON.parse(content);
      quickstarts.push(data.metadata);
    }

    return quickstarts.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
  } catch (error) {
    console.error('Error listing quickstarts:', error);
    return [];
  }
}

/**
 * Delete a quickstart file
 */
export async function deleteQuickstart(name: string): Promise<void> {
  // Validate name to prevent path traversal
  validateQuickstartName(name);
  
  const filename = `${name}.json`;
  const filepath = path.join(QUICKSTARTS_DIR, filename);
  await fs.unlink(filepath);
}
