/**
 * BTU Signed Card Check Import Script
 * 
 * Purpose: One-time import of signed card checks from Excel file
 * 
 * Process:
 * 1. Parse Excel file with columns: ID (BPS Employee ID), Bargaining Unit
 * 2. Match workers by BPS Employee ID via worker_ids table
 * 3. Apply bargaining unit mapping:
 *    - "Sub Unit" → Substitute Teacher Unit (BT2)
 *    - "Teacher Unit" → Teacher Unit (BT3)
 *    - "Para & ABA Unit" → Check worker's current bargaining unit:
 *      - If currently ABA Unit (BT4) → ABA Unit (BT4)
 *      - Otherwise → Paraprofessional Unit (BT1) + flag for review
 * 4. Create signed cardcheck records using "Dues" definition (BTU_DUES)
 * 5. Generate detailed reports
 * 
 * Usage: npx tsx scripts/oneoffs/btu-signed-card-import.ts <excel-file-path>
 * 
 * Example: npx tsx scripts/oneoffs/btu-signed-card-import.ts attached_assets/Signed_Card_Checks_from_Sirius_2026-01-15_1768504464672.xlsx
 */

import xlsx from 'xlsx';
import { db } from '../../server/db';
import { cardchecks } from '../../shared/schema/cardcheck/schema';
import { workers, workerIds } from '../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import fs from 'fs';

const BPS_EMPLOYEE_ID_TYPE = 'f01cc7f8-158d-4e83-9177-5ae361c6cba6';
const CARDCHECK_DEFINITION_ID = 'af15eadd-4768-4e4a-b2d7-23787f303608'; // BTU_DUES

const BARGAINING_UNIT_MAP: Record<string, string> = {
  'BT1': 'f127efc0-37ae-4ab7-94ae-e387f82a393d', // Paraprofessional Unit
  'BT2': '7dda7e1a-dfb6-4605-89d3-b798e3c9dcc9', // Substitute Teacher Unit
  'BT3': 'c5d17b4c-c5ab-4672-b4bb-f7a4b267bb24', // Teacher Unit
  'BT4': 'dccb010a-b56b-4ff8-ba28-4ab4e092de86', // ABA Unit
};

interface ExcelRow {
  ID: string;
  'Bargaining Unit': string;
}

interface ImportResult {
  created: number;
  skippedDuplicate: number;
  notFound: string[];
  defaultedToParaprofessional: Array<{ bpsId: string; workerId: string; originalUnit: string | null }>;
  errors: Array<{ bpsId: string; error: string }>;
  noUnitInFile: string[];
}

async function main() {
  const filePath = process.argv[2];
  
  if (!filePath) {
    console.error('Usage: npx tsx scripts/oneoffs/btu-signed-card-import.ts <excel-file-path>');
    process.exit(1);
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  
  console.log(`\n=== BTU Signed Card Check Import ===\n`);
  console.log(`Reading file: ${filePath}`);
  
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: ExcelRow[] = xlsx.utils.sheet_to_json(sheet);
  
  console.log(`Found ${data.length} records in Excel file\n`);
  
  const result: ImportResult = {
    created: 0,
    skippedDuplicate: 0,
    notFound: [],
    defaultedToParaprofessional: [],
    errors: [],
    noUnitInFile: [],
  };
  
  const bpsIds = data.map(row => String(row.ID).trim()).filter(id => id);
  
  console.log(`Looking up ${bpsIds.length} BPS Employee IDs...`);
  
  const workerIdRecords = await db
    .select({
      value: workerIds.value,
      workerId: workerIds.workerId,
    })
    .from(workerIds)
    .where(
      and(
        eq(workerIds.typeId, BPS_EMPLOYEE_ID_TYPE),
        inArray(workerIds.value, bpsIds)
      )
    );
  
  const bpsToWorkerId = new Map<string, string>();
  for (const record of workerIdRecords) {
    bpsToWorkerId.set(record.value, record.workerId);
  }
  
  console.log(`Found ${bpsToWorkerId.size} matching workers\n`);
  
  const workerIdsList = Array.from(bpsToWorkerId.values());
  const workerRecords = await db
    .select({
      id: workers.id,
      bargainingUnitId: workers.bargainingUnitId,
    })
    .from(workers)
    .where(inArray(workers.id, workerIdsList));
  
  const workerBargainingUnits = new Map<string, string | null>();
  for (const w of workerRecords) {
    workerBargainingUnits.set(w.id, w.bargainingUnitId);
  }
  
  const existingCardchecks = await db
    .select({
      workerId: cardchecks.workerId,
    })
    .from(cardchecks)
    .where(
      and(
        eq(cardchecks.cardcheckDefinitionId, CARDCHECK_DEFINITION_ID),
        inArray(cardchecks.workerId, workerIdsList)
      )
    );
  
  const existingCardcheckWorkers = new Set(existingCardchecks.map(c => c.workerId));
  
  console.log(`Processing records...\n`);
  
  const signedDate = new Date();
  const toInsert: Array<{
    workerId: string;
    cardcheckDefinitionId: string;
    status: 'signed';
    signedDate: Date;
    bargainingUnitId: string;
  }> = [];
  
  for (const row of data) {
    const bpsId = String(row.ID).trim();
    const fileUnit = row['Bargaining Unit'];
    
    if (!bpsId) continue;
    
    const workerId = bpsToWorkerId.get(bpsId);
    
    if (!workerId) {
      result.notFound.push(bpsId);
      continue;
    }
    
    if (existingCardcheckWorkers.has(workerId)) {
      result.skippedDuplicate++;
      continue;
    }
    
    if (!fileUnit) {
      result.noUnitInFile.push(bpsId);
      continue;
    }
    
    let targetBargainingUnitId: string;
    
    if (fileUnit === 'Sub Unit') {
      targetBargainingUnitId = BARGAINING_UNIT_MAP['BT2']; // Substitute Teacher Unit
    } else if (fileUnit === 'Teacher Unit') {
      targetBargainingUnitId = BARGAINING_UNIT_MAP['BT3']; // Teacher Unit
    } else if (fileUnit === 'Para & ABA Unit') {
      const currentUnit = workerBargainingUnits.get(workerId);
      
      if (currentUnit === BARGAINING_UNIT_MAP['BT4']) {
        targetBargainingUnitId = BARGAINING_UNIT_MAP['BT4']; // ABA Unit
      } else {
        targetBargainingUnitId = BARGAINING_UNIT_MAP['BT1']; // Paraprofessional Unit
        
        if (currentUnit !== BARGAINING_UNIT_MAP['BT1']) {
          result.defaultedToParaprofessional.push({
            bpsId,
            workerId,
            originalUnit: currentUnit ?? null,
          });
        }
      }
    } else {
      result.errors.push({ bpsId, error: `Unknown bargaining unit in file: ${fileUnit}` });
      continue;
    }
    
    toInsert.push({
      workerId,
      cardcheckDefinitionId: CARDCHECK_DEFINITION_ID,
      status: 'signed',
      signedDate,
      bargainingUnitId: targetBargainingUnitId,
    });
    
    existingCardcheckWorkers.add(workerId);
  }
  
  if (toInsert.length > 0) {
    console.log(`Inserting ${toInsert.length} card check records...`);
    
    const batchSize = 500;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      await db.insert(cardchecks).values(batch);
      console.log(`  Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toInsert.length / batchSize)}`);
    }
    
    result.created = toInsert.length;
  }
  
  console.log(`\n=== Import Summary ===\n`);
  console.log(`Total records in file: ${data.length}`);
  console.log(`Card checks created: ${result.created}`);
  console.log(`Skipped (already exists): ${result.skippedDuplicate}`);
  console.log(`Workers not found: ${result.notFound.length}`);
  console.log(`Missing unit in file: ${result.noUnitInFile.length}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Defaulted to Paraprofessional (needs review): ${result.defaultedToParaprofessional.length}`);
  
  if (result.notFound.length > 0) {
    console.log(`\n--- Workers Not Found (BPS Employee IDs) ---`);
    const reportPath = 'attached_assets/cardcheck_import_not_found.txt';
    fs.writeFileSync(reportPath, result.notFound.join('\n'));
    console.log(`Written to: ${reportPath}`);
    console.log(`First 10: ${result.notFound.slice(0, 10).join(', ')}${result.notFound.length > 10 ? '...' : ''}`);
  }
  
  if (result.noUnitInFile.length > 0) {
    console.log(`\n--- Missing Unit in File (BPS Employee IDs) ---`);
    const reportPath = 'attached_assets/cardcheck_import_no_unit.txt';
    fs.writeFileSync(reportPath, result.noUnitInFile.join('\n'));
    console.log(`Written to: ${reportPath}`);
    console.log(`First 10: ${result.noUnitInFile.slice(0, 10).join(', ')}${result.noUnitInFile.length > 10 ? '...' : ''}`);
  }
  
  if (result.defaultedToParaprofessional.length > 0) {
    console.log(`\n--- Defaulted to Paraprofessional Unit (Needs Review) ---`);
    const reportPath = 'attached_assets/cardcheck_import_defaulted_para.csv';
    const csvContent = 'BPS Employee ID,Worker ID,Original Bargaining Unit ID\n' +
      result.defaultedToParaprofessional.map(r => `${r.bpsId},${r.workerId},${r.originalUnit || 'NULL'}`).join('\n');
    fs.writeFileSync(reportPath, csvContent);
    console.log(`Written to: ${reportPath}`);
    console.log(`Count: ${result.defaultedToParaprofessional.length}`);
  }
  
  if (result.errors.length > 0) {
    console.log(`\n--- Errors ---`);
    const reportPath = 'attached_assets/cardcheck_import_errors.csv';
    const csvContent = 'BPS Employee ID,Error\n' +
      result.errors.map(r => `${r.bpsId},"${r.error}"`).join('\n');
    fs.writeFileSync(reportPath, csvContent);
    console.log(`Written to: ${reportPath}`);
  }
  
  console.log(`\n=== Import Complete ===\n`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
