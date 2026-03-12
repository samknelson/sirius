import { storage } from '../server/storage/database';
import { getTodayYmd } from '../shared/utils/date';

const EDLS_EMPLOYER_ID = 'a85edb4d-4e9d-4b58-8faf-b3a235235e07';
const ACTIVE_STATUS_ID = 'd73eb3ed-9837-4b7d-9504-b17c64f4ee33';

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  console.log("Starting EDLS assignment population script...");

  const employer = await storage.employers.getEmployer(EDLS_EMPLOYER_ID);
  if (!employer) {
    console.error("EDLS employer not found.");
    process.exit(1);
  }
  console.log(`Using employer: ${employer.name}`);

  const allWorkers = await storage.workers.getAllWorkers();
  console.log(`Found ${allWorkers.length} total workers`);

  const todayYmd = getTodayYmd();
  const [yearStr, monthStr, dayStr] = todayYmd.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  console.log(`Using date: ${todayYmd} (year=${year}, month=${month}, day=${day})`);

  let workersUpdated = 0;
  for (const worker of allWorkers) {
    if (worker.denormHomeEmployerId !== EDLS_EMPLOYER_ID) {
      try {
        await storage.workerHours.upsertWorkerHours({
          workerId: worker.id,
          month,
          year,
          employerId: EDLS_EMPLOYER_ID,
          employmentStatusId: ACTIVE_STATUS_ID,
          hours: 8,
          home: true,
        });
        workersUpdated++;
      } catch (error) {
        console.error(`Failed to update worker ${worker.id}:`, error);
      }
    }
  }
  console.log(`Created hours entries for ${workersUpdated} workers to set home employer`);

  await new Promise(resolve => setTimeout(resolve, 1000));

  const updatedWorkers = await storage.workers.getAllWorkers();
  const eligibleWorkers = updatedWorkers.filter(w => w.denormHomeEmployerId === EDLS_EMPLOYER_ID);
  console.log(`${eligibleWorkers.length} workers now have ${employer.name} as home employer`);

  const allSheets = await storage.edlsSheets.getAll();
  const sheets = allSheets.filter(s => s.status !== 'trash');
  console.log(`Found ${sheets.length} non-trash sheets`);

  let totalAssignmentsCreated = 0;
  const workerAssignmentCounts = new Map<string, number>();

  for (const sheet of sheets) {
    const crews = await storage.edlsCrews.getBySheetId(sheet.id);
    const existingAssignments = await storage.edlsAssignments.getBySheetId(sheet.id);
    
    if (existingAssignments.length > 0) {
      console.log(`Skipping sheet "${sheet.title}" - already has ${existingAssignments.length} assignments`);
      continue;
    }

    const availableWorkers = eligibleWorkers.filter(w => {
      const count = workerAssignmentCounts.get(w.id) || 0;
      return count < 3;
    });

    if (availableWorkers.length === 0) {
      console.log(`Skipping sheet "${sheet.title}" - no available workers`);
      continue;
    }

    let sheetAssignments = 0;
    const shuffledWorkers = [...availableWorkers].sort(() => Math.random() - 0.5);
    let workerIndex = 0;

    for (const crew of crews) {
      const slotsToFill = Math.min(
        Math.ceil(crew.workerCount * 0.3),
        shuffledWorkers.length - workerIndex,
        getRandomInt(1, 5)
      );

      for (let i = 0; i < slotsToFill && workerIndex < shuffledWorkers.length; i++) {
        const worker = shuffledWorkers[workerIndex];
        const currentCount = workerAssignmentCounts.get(worker.id) || 0;
        
        if (currentCount >= 3) {
          workerIndex++;
          i--;
          continue;
        }

        try {
          await storage.edlsAssignments.create({
            crewId: crew.id,
            workerId: worker.id,
            ymd: sheet.ymd,
          });
          workerAssignmentCounts.set(worker.id, currentCount + 1);
          sheetAssignments++;
          totalAssignmentsCreated++;
          workerIndex++;
        } catch (error: any) {
          if (error.message?.includes('CREW_FULL')) {
            break;
          }
          console.error(`Failed to create assignment for worker ${worker.id}:`, error.message || error);
        }
      }
    }

    if (sheetAssignments > 0) {
      console.log(`Created ${sheetAssignments} assignments for sheet "${sheet.title}"`);
    }
  }

  console.log("\n=== Population Complete ===");
  console.log(`Workers updated with home employer: ${workersUpdated}`);
  console.log(`Total assignments created: ${totalAssignmentsCreated}`);

  process.exit(0);
}

main().catch(console.error);
