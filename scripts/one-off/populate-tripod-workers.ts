import { storage } from "../../server/storage";

const TRIPOD_EMPLOYER_ID = "a85edb4d-4e9d-4b58-8faf-b3a235235e07";
const EMPLOYMENT_STATUS_ID = "a31b3341-d052-45c2-9f79-c01155a61896";

async function main() {
  console.log("Fetching workers...");
  
  const allWorkers = await storage.workers.getAllWorkers();
  const workersToUpdate = allWorkers.slice(0, 50);
  
  console.log(`Found ${allWorkers.length} total workers, will update ${workersToUpdate.length} with Tripod home employer`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const worker of workersToUpdate) {
    try {
      await storage.workerHours.createWorkerHours({
        workerId: worker.id,
        year: 2026,
        month: 1,
        day: 1,
        employerId: TRIPOD_EMPLOYER_ID,
        employmentStatusId: EMPLOYMENT_STATUS_ID,
        hours: 8,
        home: true,
      });
      successCount++;
      console.log(`Created hours for worker ${worker.id} (${successCount}/${workersToUpdate.length})`);
    } catch (error) {
      errorCount++;
      console.error(`Failed for worker ${worker.id}:`, error instanceof Error ? error.message : error);
    }
  }
  
  console.log(`\nComplete! Success: ${successCount}, Errors: ${errorCount}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
