import { db } from "../server/db";
import { workers, workerIds, contacts, employers, bargainingUnits, workerStewardAssignments } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CsvRow {
  Name: string;
  "Member Status": string;
  "Current Employer": string;
  "ID/Badge #": string;
  ID2: string;
  "Apprentice ID": string;
  Address: string;
  "Apt/Suite #": string;
  City: string;
  State: string;
  Zip: string;
  SSN: string;
  Phone: string;
  Email: string;
  "Last Name": string;
  "First Name": string;
  "Middle Name": string;
  "Special Designation": string;
}

interface Employer {
  id: string;
  name: string;
}

interface BargainingUnit {
  id: string;
  name: string;
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  stewardAssignmentsCreated: number;
  skippedNoEmployerMatch: number;
  unmatchedEmployers: Map<string, string[]>;
  errors: string[];
}

function parseCSV(content: string): CsvRow[] {
  const lines = content.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows: CsvRow[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: any = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row as CsvRow);
  }
  
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

function normalizeEmployerName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/elementary school/gi, 'elementary')
    .replace(/high school/gi, 'high')
    .replace(/k-8 school/gi, 'k-8')
    .replace(/academies/gi, 'academy')
    .replace(/\bk-6\b/gi, 'k-8')
    .replace(/\bk6\b/gi, 'k-8')
    .replace(/[^\w\s-]/g, '');
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

function fuzzyMatchEmployer(csvName: string, dbEmployers: Employer[]): Employer | null {
  const normalizedCsv = normalizeEmployerName(csvName);
  
  // First try exact match (normalized)
  for (const emp of dbEmployers) {
    if (normalizeEmployerName(emp.name) === normalizedCsv) {
      return emp;
    }
  }
  
  // Try contains match
  for (const emp of dbEmployers) {
    const normalizedDb = normalizeEmployerName(emp.name);
    if (normalizedDb.includes(normalizedCsv) || normalizedCsv.includes(normalizedDb)) {
      return emp;
    }
  }
  
  // Handle specific known mappings
  const knownMappings: Record<string, string> = {
    "mel king south end academies": "Mel King South End Academy",
    "bps long term leave": null as any,
    "office of human resources bps": null as any,
    "special education": null as any,
    "english high": "English High School",
    "new mission high": "New Mission High School",
    "madison park technical vocational high": "Madison Park Technical Vocational High School",
  };
  
  if (normalizedCsv in knownMappings) {
    const mapped = knownMappings[normalizedCsv];
    if (!mapped) return null;
    return dbEmployers.find(e => e.name === mapped) || null;
  }
  
  // Try Levenshtein distance for close matches
  let bestMatch: Employer | null = null;
  let bestDistance = Infinity;
  
  for (const emp of dbEmployers) {
    const normalizedDb = normalizeEmployerName(emp.name);
    const distance = levenshteinDistance(normalizedCsv, normalizedDb);
    const maxLen = Math.max(normalizedCsv.length, normalizedDb.length);
    const similarity = 1 - (distance / maxLen);
    
    if (similarity > 0.75 && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = emp;
    }
  }
  
  return bestMatch;
}

function determineBargainingUnit(memberStatus: string, bargainingUnits: BargainingUnit[]): BargainingUnit | null {
  const status = memberStatus.toLowerCase();
  
  if (status.includes('paraprofessional')) {
    return bargainingUnits.find(bu => bu.name.toLowerCase().includes('paraprofessional')) || null;
  }
  
  if (status.includes('family liaison')) {
    return bargainingUnits.find(bu => bu.name.toLowerCase().includes('paraprofessional')) || null;
  }
  
  // Default to Teacher Unit for permanent/provisional
  if (status.includes('permanent') || status.includes('provisional')) {
    return bargainingUnits.find(bu => bu.name.toLowerCase().includes('teacher')) || null;
  }
  
  // Fallback to Teacher Unit
  return bargainingUnits.find(bu => bu.name.toLowerCase().includes('teacher')) || null;
}

async function ensureBpsEmployeeIdType(): Promise<{ id: string; name: string }> {
  const BPS_EMPLOYEE_ID_TYPE_NAME = "BPS Employee ID";
  
  const result = await db.execute(sql`
    SELECT id, name FROM options_worker_id_type WHERE name = ${BPS_EMPLOYEE_ID_TYPE_NAME}
  `);
  
  if (result.rows && result.rows.length > 0) {
    const row = result.rows[0] as any;
    return { id: row.id, name: row.name };
  }
  
  const insertResult = await db.execute(sql`
    INSERT INTO options_worker_id_type (id, name, sequence)
    VALUES (gen_random_uuid(), ${BPS_EMPLOYEE_ID_TYPE_NAME}, 0)
    RETURNING id, name
  `);
  
  const newRow = insertResult.rows[0] as any;
  return { id: newRow.id, name: newRow.name };
}

async function findExistingWorkerByBadgeId(badgeId: string, idTypeId: string): Promise<{ workerId: string; contactId: string } | null> {
  if (!badgeId || !badgeId.trim()) return null;
  
  const result = await db
    .select({
      workerId: workerIds.workerId,
      contactId: workers.contactId,
    })
    .from(workerIds)
    .innerJoin(workers, eq(workerIds.workerId, workers.id))
    .where(eq(workerIds.value, badgeId.trim()));
  
  if (result.length > 0) {
    return { workerId: result[0].workerId, contactId: result[0].contactId };
  }
  
  return null;
}

async function findExistingWorkerByEmail(email: string): Promise<{ workerId: string; contactId: string } | null> {
  if (!email || !email.trim()) return null;
  
  const result = await db
    .select({
      workerId: workers.id,
      contactId: workers.contactId,
    })
    .from(workers)
    .innerJoin(contacts, eq(workers.contactId, contacts.id))
    .where(eq(contacts.email, email.toLowerCase().trim()));
  
  if (result.length > 0) {
    return { workerId: result[0].workerId, contactId: result[0].contactId };
  }
  
  return null;
}

async function createWorkerWithContact(
  row: CsvRow,
  bargainingUnitId: string | null,
  bpsIdTypeId: string
): Promise<{ workerId: string; contactId: string }> {
  const displayName = row["Middle Name"]
    ? `${row["Last Name"]}, ${row["First Name"]} ${row["Middle Name"]}`
    : `${row["Last Name"]}, ${row["First Name"]}`;
  
  const [contact] = await db
    .insert(contacts)
    .values({
      displayName,
      given: row["First Name"],
      family: row["Last Name"],
      middle: row["Middle Name"] || null,
      email: row.Email?.toLowerCase().trim() || null,
    })
    .returning();
  
  const [worker] = await db
    .insert(workers)
    .values({
      contactId: contact.id,
      bargainingUnitId,
    })
    .returning();
  
  // Add BPS Employee ID if present
  if (row["ID/Badge #"]?.trim()) {
    await db.insert(workerIds).values({
      workerId: worker.id,
      typeId: bpsIdTypeId,
      value: row["ID/Badge #"].trim(),
    });
  }
  
  // Add phone number if present
  if (row.Phone?.trim()) {
    await db.execute(sql`
      INSERT INTO contact_phone (id, contact_id, phone_number, is_primary)
      VALUES (gen_random_uuid(), ${contact.id}, ${row.Phone.trim()}, true)
    `);
  }
  
  // Add address if present
  if (row.Address?.trim() && row.City?.trim() && row.State?.trim() && row.Zip?.trim()) {
    const street = row["Apt/Suite #"]?.trim()
      ? `${row.Address.trim()}, ${row["Apt/Suite #"].trim()}`
      : row.Address.trim();
    
    await db.execute(sql`
      INSERT INTO contact_postal (id, contact_id, street, city, state, postal_code, country, is_primary)
      VALUES (gen_random_uuid(), ${contact.id}, ${street}, ${row.City.trim()}, ${row.State.trim()}, ${row.Zip.trim()}, 'US', true)
    `);
  }
  
  return { workerId: worker.id, contactId: contact.id };
}

async function updateWorkerContact(
  contactId: string,
  row: CsvRow
): Promise<void> {
  const displayName = row["Middle Name"]
    ? `${row["Last Name"]}, ${row["First Name"]} ${row["Middle Name"]}`
    : `${row["Last Name"]}, ${row["First Name"]}`;
  
  await db
    .update(contacts)
    .set({
      displayName,
      given: row["First Name"],
      family: row["Last Name"],
      middle: row["Middle Name"] || null,
      email: row.Email?.toLowerCase().trim() || null,
    })
    .where(eq(contacts.id, contactId));
}

async function createStewardAssignment(
  workerId: string,
  employerId: string,
  bargainingUnitId: string
): Promise<boolean> {
  // Check if assignment already exists
  const existing = await db
    .select()
    .from(workerStewardAssignments)
    .where(
      sql`${workerStewardAssignments.workerId} = ${workerId} 
          AND ${workerStewardAssignments.employerId} = ${employerId}
          AND ${workerStewardAssignments.bargainingUnitId} = ${bargainingUnitId}`
    );
  
  if (existing.length > 0) {
    return false;
  }
  
  await db.insert(workerStewardAssignments).values({
    workerId,
    employerId,
    bargainingUnitId,
  });
  
  return true;
}

async function main() {
  console.log("Starting Building Rep Import...\n");
  
  // Load CSV
  const csvPath = path.resolve(__dirname, "../attached_assets/Building_Reps_1770042208874.csv");
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCSV(csvContent);
  console.log(`Loaded ${rows.length} rows from CSV\n`);
  
  // Load employers and bargaining units
  const dbEmployers = await db.select({ id: employers.id, name: employers.name }).from(employers);
  const dbBargainingUnits = await db.select({ id: bargainingUnits.id, name: bargainingUnits.name }).from(bargainingUnits);
  
  console.log(`Found ${dbEmployers.length} employers in database`);
  console.log(`Found ${dbBargainingUnits.length} bargaining units in database\n`);
  
  // Ensure BPS Employee ID type exists
  const bpsIdType = await ensureBpsEmployeeIdType();
  console.log(`BPS Employee ID type: ${bpsIdType.id}\n`);
  
  const result: ImportResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    stewardAssignmentsCreated: 0,
    skippedNoEmployerMatch: 0,
    unmatchedEmployers: new Map(),
    errors: [],
  };
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const csvEmployerName = row["Current Employer"];
    
    try {
      // Match employer
      const employer = fuzzyMatchEmployer(csvEmployerName, dbEmployers);
      
      if (!employer) {
        result.skippedNoEmployerMatch++;
        const existing = result.unmatchedEmployers.get(csvEmployerName) || [];
        existing.push(row.Name);
        result.unmatchedEmployers.set(csvEmployerName, existing);
        continue;
      }
      
      // Determine bargaining unit
      const bargainingUnit = determineBargainingUnit(row["Member Status"], dbBargainingUnits);
      
      if (!bargainingUnit) {
        result.errors.push(`No bargaining unit match for ${row.Name}: ${row["Member Status"]}`);
        continue;
      }
      
      // Check if worker exists
      let workerData = await findExistingWorkerByBadgeId(row["ID/Badge #"], bpsIdType.id);
      
      if (!workerData && row.Email) {
        workerData = await findExistingWorkerByEmail(row.Email);
      }
      
      if (workerData) {
        // Update existing worker
        await updateWorkerContact(workerData.contactId, row);
        result.updated++;
      } else {
        // Create new worker
        workerData = await createWorkerWithContact(row, bargainingUnit.id, bpsIdType.id);
        result.created++;
      }
      
      // Create steward assignment
      const assignmentCreated = await createStewardAssignment(
        workerData.workerId,
        employer.id,
        bargainingUnit.id
      );
      
      if (assignmentCreated) {
        result.stewardAssignmentsCreated++;
      }
      
      if ((i + 1) % 50 === 0) {
        console.log(`Processed ${i + 1}/${rows.length} rows...`);
      }
    } catch (error) {
      result.errors.push(`Error processing ${row.Name}: ${error}`);
    }
  }
  
  // Print results
  console.log("\n=== IMPORT RESULTS ===\n");
  console.log(`Total rows: ${result.total}`);
  console.log(`Workers created: ${result.created}`);
  console.log(`Workers updated: ${result.updated}`);
  console.log(`Steward assignments created: ${result.stewardAssignmentsCreated}`);
  console.log(`Skipped (no employer match): ${result.skippedNoEmployerMatch}`);
  
  if (result.unmatchedEmployers.size > 0) {
    console.log("\n=== UNMATCHED EMPLOYERS ===\n");
    for (const [employer, workers] of result.unmatchedEmployers) {
      console.log(`"${employer}" (${workers.length} workers):`);
      workers.slice(0, 3).forEach(w => console.log(`  - ${w}`));
      if (workers.length > 3) {
        console.log(`  ... and ${workers.length - 3} more`);
      }
    }
  }
  
  if (result.errors.length > 0) {
    console.log("\n=== ERRORS ===\n");
    result.errors.forEach(err => console.log(`- ${err}`));
  }
  
  console.log("\nImport complete!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
