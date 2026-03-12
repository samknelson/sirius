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
import { optionsSkills, workerSkills } from "../shared/schema/worker/skills/schema";
import { optionsCertifications, workerCertifications } from "../shared/schema/worker/certifications/schema";
import * as fs from "fs";
import * as path from "path";

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
    optionsSkills: any[];
    optionsCertifications: any[];
    contacts: any[];
    phoneNumbers: any[];
    contactPostal: any[];
    employers: any[];
    employerContacts: any[];
    workers: any[];
    workerBans: any[];
    workerHours: any[];
    workerSkills: any[];
    workerCertifications: any[];
    workerDispatchStatus: any[];
    workerDispatchDnc: any[];
    workerDispatchHfe: any[];
    dispatchJobs: any[];
    dispatches: any[];
  };
}

async function createSnapshot(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("ERROR: Cannot create snapshot in production environment");
    process.exit(1);
  }

  console.log("Creating demo data snapshot...\n");

  const snapshot: DemoSnapshot = {
    version: "1.3.0",
    createdAt: new Date().toISOString(),
    tables: {
      optionsGender: [],
      optionsEmployerType: [],
      optionsEmploymentStatus: [],
      optionsWorkerWs: [],
      optionsDispatchJobType: [],
      optionsEmployerContactType: [],
      optionsSkills: [],
      optionsCertifications: [],
      contacts: [],
      phoneNumbers: [],
      contactPostal: [],
      employers: [],
      employerContacts: [],
      workers: [],
      workerBans: [],
      workerHours: [],
      workerSkills: [],
      workerCertifications: [],
      workerDispatchStatus: [],
      workerDispatchDnc: [],
      workerDispatchHfe: [],
      dispatchJobs: [],
      dispatches: [],
    },
  };

  try {
    console.log("Fetching options tables...");
    snapshot.tables.optionsGender = await db.select().from(optionsGender);
    snapshot.tables.optionsEmployerType = await db.select().from(optionsEmployerType);
    snapshot.tables.optionsEmploymentStatus = await db.select().from(optionsEmploymentStatus);
    snapshot.tables.optionsWorkerWs = await db.select().from(optionsWorkerWs);
    snapshot.tables.optionsDispatchJobType = await db.select().from(optionsDispatchJobType);
    snapshot.tables.optionsEmployerContactType = await db.select().from(optionsEmployerContactType);
    snapshot.tables.optionsSkills = await db.select().from(optionsSkills);
    snapshot.tables.optionsCertifications = await db.select().from(optionsCertifications);

    console.log("Fetching entity tables...");
    snapshot.tables.contacts = await db.select().from(contacts);
    snapshot.tables.phoneNumbers = await db.select().from(phoneNumbers);
    snapshot.tables.contactPostal = await db.select().from(contactPostal);
    snapshot.tables.employers = await db.select().from(employers);
    snapshot.tables.employerContacts = await db.select().from(employerContacts);
    snapshot.tables.workers = await db.select().from(workers);
    snapshot.tables.workerBans = await db.select().from(workerBans);

    console.log("Fetching relationship tables...");
    snapshot.tables.workerHours = await db.select().from(workerHours);
    snapshot.tables.workerSkills = await db.select().from(workerSkills);
    snapshot.tables.workerCertifications = await db.select().from(workerCertifications);
    snapshot.tables.workerDispatchStatus = await db.select().from(workerDispatchStatus);
    snapshot.tables.workerDispatchDnc = await db.select().from(workerDispatchDnc);
    snapshot.tables.workerDispatchHfe = await db.select().from(workerDispatchHfe);

    console.log("Fetching dispatch tables...");
    snapshot.tables.dispatchJobs = await db.select().from(dispatchJobs);
    snapshot.tables.dispatches = await db.select().from(dispatches);

    const outputPath = path.join(process.cwd(), "data", "demo-snapshot.json");
    fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));

    console.log("\n--- Snapshot Summary ---");
    console.log(`Version: ${snapshot.version}`);
    console.log(`Created: ${snapshot.createdAt}`);
    console.log("\nRecord counts:");
    for (const [table, records] of Object.entries(snapshot.tables)) {
      console.log(`  ${table}: ${(records as any[]).length} records`);
    }
    console.log(`\nSnapshot saved to: ${outputPath}`);

  } catch (error) {
    console.error("Failed to create snapshot:", error);
    process.exit(1);
  }

  process.exit(0);
}

createSnapshot();
