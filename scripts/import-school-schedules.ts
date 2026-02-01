import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { employers } from '../shared/schema';
import { sitespecificBtuSchoolAttributes } from '../shared/schema/sitespecific/btu/schema';
import { eq, ilike } from 'drizzle-orm';

interface ScheduleEntry {
  label: string;
  startTime: string;
  endTime: string;
  note: string | null;
}

interface SchoolScheduleData {
  region: string;
  schoolName: string;
  schedules: ScheduleEntry[];
  originalNotes: string;
}

interface ImportResult {
  schoolName: string;
  status: 'created' | 'updated' | 'not_found' | 'error';
  employerId?: string;
  schedulesCount?: number;
  error?: string;
}

async function findEmployerByName(name: string): Promise<{ id: string; name: string } | null> {
  const results = await db
    .select({ id: employers.id, name: employers.name })
    .from(employers)
    .where(ilike(employers.name, name.trim()));
  
  if (results.length === 1) {
    return results[0];
  }
  
  if (results.length === 0) {
    const fuzzyResults = await db
      .select({ id: employers.id, name: employers.name })
      .from(employers)
      .where(ilike(employers.name, `%${name.trim()}%`));
    
    if (fuzzyResults.length === 1) {
      return fuzzyResults[0];
    }
  }
  
  return null;
}

async function importSchoolSchedules(dryRun: boolean = true): Promise<ImportResult[]> {
  const jsonPath = path.join(process.cwd(), 'attached_assets/parsed-school-schedules.json');
  const content = fs.readFileSync(jsonPath, 'utf-8');
  const schools: SchoolScheduleData[] = JSON.parse(content);
  
  const results: ImportResult[] = [];
  
  console.log(`\n${dryRun ? '=== DRY RUN ===' : '=== IMPORTING ==='}`);
  console.log(`Processing ${schools.length} schools...\n`);
  
  for (const school of schools) {
    if (school.schedules.length === 0) {
      results.push({
        schoolName: school.schoolName,
        status: 'not_found',
        error: 'No schedules to import',
      });
      continue;
    }
    
    try {
      const employer = await findEmployerByName(school.schoolName);
      
      if (!employer) {
        results.push({
          schoolName: school.schoolName,
          status: 'not_found',
          error: 'Employer not found in database',
        });
        continue;
      }
      
      const existingAttrs = await db
        .select()
        .from(sitespecificBtuSchoolAttributes)
        .where(eq(sitespecificBtuSchoolAttributes.employerId, employer.id));
      
      if (dryRun) {
        results.push({
          schoolName: school.schoolName,
          status: existingAttrs.length > 0 ? 'updated' : 'created',
          employerId: employer.id,
          schedulesCount: school.schedules.length,
        });
      } else {
        if (existingAttrs.length > 0) {
          await db
            .update(sitespecificBtuSchoolAttributes)
            .set({ schedules: school.schedules })
            .where(eq(sitespecificBtuSchoolAttributes.id, existingAttrs[0].id));
          
          results.push({
            schoolName: school.schoolName,
            status: 'updated',
            employerId: employer.id,
            schedulesCount: school.schedules.length,
          });
        } else {
          const siriusId = `school-attr-${employer.id}`;
          await db
            .insert(sitespecificBtuSchoolAttributes)
            .values({
              siriusId,
              employerId: employer.id,
              schedules: school.schedules,
            });
          
          results.push({
            schoolName: school.schoolName,
            status: 'created',
            employerId: employer.id,
            schedulesCount: school.schedules.length,
          });
        }
      }
    } catch (error) {
      results.push({
        schoolName: school.schoolName,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  
  console.log('\n========================================');
  console.log('  School Schedule Import Tool');
  console.log('========================================');
  
  if (dryRun) {
    console.log('\nRunning in DRY RUN mode. No changes will be made.');
    console.log('Add --execute flag to perform the actual import.\n');
  }
  
  const results = await importSchoolSchedules(dryRun);
  
  const created = results.filter(r => r.status === 'created');
  const updated = results.filter(r => r.status === 'updated');
  const notFound = results.filter(r => r.status === 'not_found');
  const errors = results.filter(r => r.status === 'error');
  
  console.log('\n========================================');
  console.log('  RESULTS SUMMARY');
  console.log('========================================');
  console.log(`  Would create: ${created.length}`);
  console.log(`  Would update: ${updated.length}`);
  console.log(`  Not found:    ${notFound.length}`);
  console.log(`  Errors:       ${errors.length}`);
  console.log('========================================\n');
  
  if (notFound.length > 0) {
    console.log('\n--- Schools Not Found in Database ---');
    for (const r of notFound) {
      console.log(`  - ${r.schoolName}: ${r.error}`);
    }
  }
  
  if (errors.length > 0) {
    console.log('\n--- Errors ---');
    for (const r of errors) {
      console.log(`  - ${r.schoolName}: ${r.error}`);
    }
  }
  
  if (created.length > 0 || updated.length > 0) {
    console.log('\n--- Matched Schools ---');
    for (const r of [...created, ...updated].slice(0, 20)) {
      console.log(`  - ${r.schoolName} (${r.status}, ${r.schedulesCount} schedules)`);
    }
    if (created.length + updated.length > 20) {
      console.log(`  ... and ${created.length + updated.length - 20} more`);
    }
  }
  
  if (dryRun && (created.length > 0 || updated.length > 0)) {
    console.log('\n\nTo execute the import, run:');
    console.log('  npx tsx scripts/import-school-schedules.ts --execute\n');
  }
  
  process.exit(0);
}

main().catch(console.error);
