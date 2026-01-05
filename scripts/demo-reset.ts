import { db } from "../server/db";
import { 
  contacts, 
  phoneNumbers, 
  contactPostal,
  employers, 
  employerContacts,
  optionsEmployerContactType,
  workers, 
  workerBans,
  workerHours,
  optionsGender,
  optionsEmployerType,
  optionsEmploymentStatus,
  optionsWorkerWs,
  optionsDispatchJobType,
  workerDispatchStatus,
  dispatchJobs,
  dispatches,
} from "../shared/schema";
import { workerDispatchDnc } from "../shared/schema/dispatch/dnc-schema";
import { workerDispatchHfe } from "../shared/schema/dispatch/hfe-schema";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

interface DemoSnapshot {
  version: string;
  createdAt: string;
  tables: {
    optionsGender: any[];
    optionsEmployerType: any[];
    optionsEmploymentStatus: any[];
    optionsWorkerWs: any[];
    optionsDispatchJobType: any[];
    optionsEmployerContactType: any[];
    contacts: any[];
    phoneNumbers: any[];
    contactPostal: any[];
    employers: any[];
    employerContacts: any[];
    workers: any[];
    workerBans: any[];
    workerHours: any[];
    workerDispatchStatus: any[];
    workerDispatchDnc: any[];
    workerDispatchHfe: any[];
    dispatchJobs: any[];
    dispatches: any[];
  };
}

function parseDateStrings(records: any[], dateFields: string[]): any[] {
  return records.map(record => {
    const parsed = { ...record };
    for (const field of dateFields) {
      if (parsed[field] && typeof parsed[field] === 'string') {
        parsed[field] = new Date(parsed[field]);
      }
    }
    return parsed;
  });
}

async function confirmReset(): Promise<boolean> {
  if (process.argv.includes("--force") || process.argv.includes("-f")) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      "\nThis will DELETE all existing data and restore from snapshot.\nType 'yes' to confirm: ",
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "yes");
      }
    );
  });
}

async function resetDemo(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("ERROR: Cannot reset demo data in production environment");
    process.exit(1);
  }

  const snapshotPath = path.join(process.cwd(), "data", "demo-snapshot.json");

  if (!fs.existsSync(snapshotPath)) {
    console.error(`ERROR: Snapshot file not found at ${snapshotPath}`);
    console.error("Run 'npm run demo:snapshot' first to create a snapshot.");
    process.exit(1);
  }

  console.log("Loading snapshot...");
  const snapshot: DemoSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
  console.log(`Snapshot version: ${snapshot.version}`);
  console.log(`Snapshot created: ${snapshot.createdAt}`);

  const confirmed = await confirmReset();
  if (!confirmed) {
    console.log("Reset cancelled.");
    process.exit(0);
  }

  console.log("\nResetting demo data...\n");

  try {
    console.log("Clearing existing data using TRUNCATE CASCADE...");
    
    await db.execute(sql`
      TRUNCATE TABLE 
        dispatches,
        dispatch_jobs,
        worker_dispatch_status,
        worker_dispatch_dnc,
        worker_dispatch_hfe,
        worker_hours,
        worker_bans,
        workers,
        employer_contacts,
        employers,
        contact_postal,
        contact_phone,
        contacts,
        options_dispatch_job_type,
        options_worker_ws,
        options_employment_status,
        options_employer_type,
        options_employer_contact_type,
        options_gender
      RESTART IDENTITY CASCADE
    `);
    console.log("  - Cleared all demo tables");

    console.log("\nInserting snapshot data (in dependency order)...");

    if (snapshot.tables.optionsGender.length > 0) {
      await db.insert(optionsGender).values(snapshot.tables.optionsGender);
      console.log(`  - Inserted ${snapshot.tables.optionsGender.length} options_gender records`);
    }

    if (snapshot.tables.optionsEmployerType.length > 0) {
      await db.insert(optionsEmployerType).values(snapshot.tables.optionsEmployerType);
      console.log(`  - Inserted ${snapshot.tables.optionsEmployerType.length} options_employer_type records`);
    }

    if (snapshot.tables.optionsEmploymentStatus.length > 0) {
      await db.insert(optionsEmploymentStatus).values(snapshot.tables.optionsEmploymentStatus);
      console.log(`  - Inserted ${snapshot.tables.optionsEmploymentStatus.length} options_employment_status records`);
    }

    if (snapshot.tables.optionsWorkerWs.length > 0) {
      await db.insert(optionsWorkerWs).values(snapshot.tables.optionsWorkerWs);
      console.log(`  - Inserted ${snapshot.tables.optionsWorkerWs.length} options_worker_ws records`);
    }

    if (snapshot.tables.optionsDispatchJobType.length > 0) {
      await db.insert(optionsDispatchJobType).values(snapshot.tables.optionsDispatchJobType);
      console.log(`  - Inserted ${snapshot.tables.optionsDispatchJobType.length} options_dispatch_job_type records`);
    }

    if (snapshot.tables.optionsEmployerContactType?.length > 0) {
      await db.insert(optionsEmployerContactType).values(snapshot.tables.optionsEmployerContactType);
      console.log(`  - Inserted ${snapshot.tables.optionsEmployerContactType.length} options_employer_contact_type records`);
    }

    if (snapshot.tables.contacts.length > 0) {
      await db.insert(contacts).values(snapshot.tables.contacts);
      console.log(`  - Inserted ${snapshot.tables.contacts.length} contacts records`);
    }

    if (snapshot.tables.phoneNumbers.length > 0) {
      const records = parseDateStrings(snapshot.tables.phoneNumbers, ['createdAt']);
      await db.insert(phoneNumbers).values(records);
      console.log(`  - Inserted ${records.length} phone_numbers records`);
    }

    if (snapshot.tables.contactPostal?.length > 0) {
      const records = parseDateStrings(snapshot.tables.contactPostal, ['createdAt']);
      await db.insert(contactPostal).values(records);
      console.log(`  - Inserted ${records.length} contact_postal records`);
    }

    if (snapshot.tables.employers.length > 0) {
      await db.insert(employers).values(snapshot.tables.employers);
      console.log(`  - Inserted ${snapshot.tables.employers.length} employers records`);
    }

    if (snapshot.tables.employerContacts?.length > 0) {
      await db.insert(employerContacts).values(snapshot.tables.employerContacts);
      console.log(`  - Inserted ${snapshot.tables.employerContacts.length} employer_contacts records`);
    }

    if (snapshot.tables.workers.length > 0) {
      await db.insert(workers).values(snapshot.tables.workers);
      console.log(`  - Inserted ${snapshot.tables.workers.length} workers records`);
    }

    if (snapshot.tables.workerBans?.length > 0) {
      const records = parseDateStrings(snapshot.tables.workerBans, ['startDate', 'endDate']);
      await db.insert(workerBans).values(records);
      console.log(`  - Inserted ${records.length} worker_bans records`);
    }

    if (snapshot.tables.workerHours.length > 0) {
      await db.insert(workerHours).values(snapshot.tables.workerHours);
      console.log(`  - Inserted ${snapshot.tables.workerHours.length} worker_hours records`);
    }

    if (snapshot.tables.workerDispatchStatus.length > 0) {
      const records = parseDateStrings(snapshot.tables.workerDispatchStatus, ['seniorityDate']);
      await db.insert(workerDispatchStatus).values(records);
      console.log(`  - Inserted ${records.length} worker_dispatch_status records`);
    }

    if (snapshot.tables.workerDispatchDnc?.length > 0) {
      await db.insert(workerDispatchDnc).values(snapshot.tables.workerDispatchDnc);
      console.log(`  - Inserted ${snapshot.tables.workerDispatchDnc.length} worker_dispatch_dnc records`);
    }

    if (snapshot.tables.workerDispatchHfe?.length > 0) {
      await db.insert(workerDispatchHfe).values(snapshot.tables.workerDispatchHfe);
      console.log(`  - Inserted ${snapshot.tables.workerDispatchHfe.length} worker_dispatch_hfe records`);
    }

    if (snapshot.tables.dispatchJobs.length > 0) {
      const records = parseDateStrings(snapshot.tables.dispatchJobs, ['startDate', 'createdAt']);
      await db.insert(dispatchJobs).values(records);
      console.log(`  - Inserted ${records.length} dispatch_jobs records`);
    }

    if (snapshot.tables.dispatches.length > 0) {
      const records = parseDateStrings(snapshot.tables.dispatches, ['startDate', 'endDate']);
      await db.insert(dispatches).values(records);
      console.log(`  - Inserted ${records.length} dispatches records`);
    }

    console.log("\nResetting serial sequences...");
    await db.execute(sql`SELECT setval('employers_sirius_id_seq', COALESCE((SELECT MAX(sirius_id) FROM employers), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('workers_sirius_id_seq', COALESCE((SELECT MAX(sirius_id) FROM workers), 0) + 1, false)`);
    console.log("  - Reset employer and worker sirius_id sequences");

    console.log("\n--- Demo Reset Complete ---");
    console.log("The database has been restored to the snapshot state.");

  } catch (error) {
    console.error("\nERROR: Reset failed:", error);
    console.error("The database may be in an inconsistent state.");
    process.exit(1);
  }

  process.exit(0);
}

resetDemo();
