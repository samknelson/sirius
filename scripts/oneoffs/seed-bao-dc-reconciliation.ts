/**
 * Idempotent DEVELOPMENT-ONLY fixtures for inspecting Disability Credit
 * reconciliation through the real worker UI and monthly-hours upload.
 *
 * Run: npm run seed:bao-dc-reconciliation
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import {
  contacts,
  employers,
  optionsEmploymentStatus,
  sitespecificBaoDcCaseMonths,
  sitespecificBaoDcCases,
  sitespecificBaoDcEvents,
  workerHours,
  workers,
} from "@shared/schema";
import { ensureBaoDcSchema } from "../../tests/sitespecific/fixtures/bao-schema";

const MARKER = "dev-seed:bao-dc-reconciliation:v1";
const WORK_MONTH = "2026-05-01";
const THRESHOLD = 60;
const EMPLOYER_SIRIUS_ID = "DEV-BAO-DC-RECONCILIATION";
const ACTIVE_STATUS_CODE = "DEV-BAO-DC-ACTIVE";
const UPLOAD_FIXTURE = "scripts/oneoffs/fixtures/bao-dc-reconciliation-may-2026.csv";
const ALLOWED_DATABASE_HOSTS = new Set(["helium", "localhost", "127.0.0.1", "::1"]);

type Scenario = {
  slug: string;
  name: string;
  ssn: string;
  employerHours: number;
  dcHours: number;
  status: "granted" | "removed";
  next: string;
};

const scenarios: Scenario[] = [
  {
    slug: "below-threshold",
    name: "DC Reconciliation - Below Threshold (20 + 40)",
    ssn: "900-48-5001",
    employerHours: 20,
    dcHours: 40,
    status: "granted",
    next: "Upload 55 total hours for May 2026; DC should become 5 and remain granted.",
  },
  {
    slug: "threshold-crossing",
    name: "DC Reconciliation - Threshold Crossing (55 + 5)",
    ssn: "900-48-5002",
    employerHours: 55,
    dcHours: 5,
    status: "granted",
    next: "Upload 60 total hours for May 2026; DC should be removed and annual capacity restored.",
  },
  {
    slug: "downward-unchanged",
    name: "DC Reconciliation - Downward Correction Stays 5",
    ssn: "900-48-5003",
    employerHours: 20,
    dcHours: 5,
    status: "granted",
    next: "Re-upload 20 or fewer hours; DC must stay 5 and must not regrow.",
  },
  {
    slug: "already-removed",
    name: "DC Reconciliation - Already Removed at 60",
    ssn: "900-48-5004",
    employerHours: 60,
    dcHours: 0,
    status: "removed",
    next: "Re-upload any value; the removed month must not return or consume annual capacity.",
  },
];

async function assertDevelopmentTarget() {
  if (process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed Disability Credit reconciliation data in a deployment");
  }
  if (process.env.ALLOW_BAO_DC_RECONCILIATION_SEED !== "1") {
    throw new Error(
      "Explicit opt-in required: run npm run seed:bao-dc-reconciliation in a development workspace",
    );
  }
  const rawUrl = process.env.EXTERNAL_DATABASE_URL || process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("No database URL is configured");
  const hostname = new URL(rawUrl).hostname;
  if (!ALLOWED_DATABASE_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing to seed database host "${hostname}"; only the local Replit development database is allowed`,
    );
  }
}

async function findOrCreateWorker(scenario: Scenario) {
  const normalizedSsn = scenario.ssn.replace(/\D/g, "");
  const [bySsn] = await db.select().from(workers).where(eq(workers.ssn, normalizedSsn));
  if (bySsn) {
    const [ownedCase] = await db
      .select({ id: sitespecificBaoDcCases.id })
      .from(sitespecificBaoDcCases)
      .where(
        and(
          eq(sitespecificBaoDcCases.workerId, bySsn.id),
          eq(sitespecificBaoDcCases.data, { seedMarker: `${MARKER}:${scenario.slug}` }),
        ),
      );
    if (!ownedCase) {
      throw new Error(`Synthetic SSN ${scenario.ssn} belongs to an unrelated worker; refusing to reuse it`);
    }
    return bySsn;
  }

  const [byName] = await db
    .select({ worker: workers })
    .from(workers)
    .innerJoin(contacts, eq(workers.contactId, contacts.id))
    .where(eq(contacts.displayName, scenario.name));
  let worker = byName?.worker;
  if (worker) {
    const [ownedCase] = await db
      .select({ id: sitespecificBaoDcCases.id })
      .from(sitespecificBaoDcCases)
      .where(eq(sitespecificBaoDcCases.workerId, worker.id));
    if (!ownedCase) {
      throw new Error(`Worker name "${scenario.name}" is already used by unrelated data`);
    }
  } else {
    worker = await storage.workers.createWorker(scenario.name);
  }
  const [updated] = await db
    .update(workers)
    .set({ ssn: normalizedSsn })
    .where(eq(workers.id, worker.id))
    .returning();
  await db
    .update(contacts)
    .set({ birthDate: "1990-01-01" })
    .where(eq(contacts.id, updated.contactId));
  return updated;
}

async function main() {
  await assertDevelopmentTarget();
  await ensureBaoDcSchema();

  const [employer] = await db
    .insert(employers)
    .values({
      siriusId: EMPLOYER_SIRIUS_ID,
      name: "DEV DC Reconciliation Employer",
      isActive: true,
    })
    .onConflictDoUpdate({
      target: employers.siriusId,
      set: { name: "DEV DC Reconciliation Employer", isActive: true },
    })
    .returning();
  const [existingActiveStatus] = await db
    .select()
    .from(optionsEmploymentStatus)
    .where(eq(optionsEmploymentStatus.code, ACTIVE_STATUS_CODE));
  const activeStatus =
    existingActiveStatus ??
    (
      await db
        .insert(optionsEmploymentStatus)
        .values({
          name: "DEV DC Reconciliation Active",
          code: ACTIVE_STATUS_CODE,
          employed: true,
        })
        .returning()
    )[0];
  const dcIdentity = await storage.baoDisabilityCredit.ensureDcFundIdentities();

  const output: Array<{ scenario: Scenario; workerId: string; caseId: string }> = [];
  for (const scenario of scenarios) {
    const worker = await findOrCreateWorker(scenario);
    const existingCases = await db
      .select()
      .from(sitespecificBaoDcCases)
      .where(eq(sitespecificBaoDcCases.workerId, worker.id));
    let theCase = existingCases.find(
      (row) => (row.data as { seedMarker?: string } | null)?.seedMarker === `${MARKER}:${scenario.slug}`,
    );
    if (!theCase) {
      [theCase] = await db
        .insert(sitespecificBaoDcCases)
        .values({
          workerId: worker.id,
          status: "approved",
          openedYmd: WORK_MONTH,
          qualifyingBasis: {
            asOfYmd: WORK_MONTH,
            conditions: ["staff_exception"],
            exceptionReason: "Development reconciliation fixture",
          },
          data: { seedMarker: `${MARKER}:${scenario.slug}` },
        })
        .returning();
    }

    const existingMonths = await db
      .select()
      .from(sitespecificBaoDcCaseMonths)
      .where(
        and(
          eq(sitespecificBaoDcCaseMonths.workerId, worker.id),
          eq(sitespecificBaoDcCaseMonths.workMonthYmd, WORK_MONTH),
        ),
      );
    const foreignMonth = existingMonths.find((row) => row.caseId !== theCase!.id);
    if (foreignMonth) {
      throw new Error(
        `${scenario.name} already has an unrelated May 2026 DC month (${foreignMonth.id}); refusing to overwrite it`,
      );
    }
    const monthData = {
      threshold: THRESHOLD,
      coverageMonthYmd: WORK_MONTH,
      qualifyingHoursAtGrant: 20,
      grantedHours: scenario.dcHours,
      seedMarker: MARKER,
    };
    let monthRow = existingMonths[0];
    if (monthRow) {
      [monthRow] = await db
        .update(sitespecificBaoDcCaseMonths)
        .set({
          status: scenario.status,
          voidReason:
            scenario.status === "removed"
              ? "Reconciled away — later employer hours reached the continuation threshold"
              : null,
          data: monthData,
        })
        .where(eq(sitespecificBaoDcCaseMonths.id, monthRow.id))
        .returning();
    } else {
      [monthRow] = await db
        .insert(sitespecificBaoDcCaseMonths)
        .values({
          caseId: theCase.id,
          workerId: worker.id,
          workMonthYmd: WORK_MONTH,
          status: scenario.status,
          voidReason:
            scenario.status === "removed"
              ? "Reconciled away — later employer hours reached the continuation threshold"
              : null,
          data: monthData,
        })
        .returning();
    }

    await storage.workerHours.upsertWorkerHours({
      workerId: worker.id,
      employerId: employer.id,
      employmentStatusId: activeStatus.id,
      year: 2026,
      month: 5,
      day: 1,
      hours: scenario.employerHours,
    });
    const dcRows = await db
      .select()
      .from(workerHours)
      .where(
        and(
          eq(workerHours.workerId, worker.id),
          eq(workerHours.employerId, dcIdentity.employerId),
          eq(workerHours.year, 2026),
          eq(workerHours.month, 5),
        ),
      );
    await db.delete(workerHours).where(
      and(
        eq(workerHours.workerId, worker.id),
        eq(workerHours.employerId, dcIdentity.employerId),
        eq(workerHours.year, 2026),
        eq(workerHours.month, 5),
      ),
    );
    if (scenario.dcHours > 0) {
      await storage.workerHours.upsertWorkerHours({
        workerId: worker.id,
        employerId: dcIdentity.employerId,
        employmentStatusId: dcIdentity.employmentStatusId,
        year: 2026,
        month: 5,
        day: dcRows[0]?.day ?? 1,
        hours: scenario.dcHours,
      });
    }
    if (scenario.status === "removed") {
      await db
        .insert(sitespecificBaoDcEvents)
        .values({
          eventType: "case_month_reconciled",
          workerId: worker.id,
          caseId: theCase.id,
          dedupeKey: `${MARKER}:${scenario.slug}:removed`,
          payload: {
            monthId: monthRow.id,
            workMonthYmd: WORK_MONTH,
            threshold: THRESHOLD,
            qualifyingHours: scenario.employerHours,
            previousDcHours: 5,
            dcHours: 0,
            removed: true,
          },
        })
        .onConflictDoNothing({ target: sitespecificBaoDcEvents.dedupeKey });
    }
    const uploadMatches = await storage.workers.getWorkersBySSNs([scenario.ssn]);
    const uploadMatch = uploadMatches.get(scenario.ssn.replace(/\D/g, ""));
    if (uploadMatch?.id !== worker.id) {
      throw new Error(
        `Monthly-hours SSN lookup did not resolve ${scenario.ssn} to seeded worker ${worker.id}`,
      );
    }
    output.push({ scenario, workerId: worker.id, caseId: theCase.id });
  }

  console.log("\nDisability Credit reconciliation fixtures are ready:\n");
  for (const row of output) {
    console.log(`${row.scenario.name}`);
    console.log(`  Worker: /workers/${row.workerId}/sitespecific/bao/disability-credit`);
    console.log(`  Case:   /sitespecific/bao/dc/cases/${row.caseId}`);
    console.log(`  Upload SSN: ${row.scenario.ssn}`);
    console.log(`  State:  employer=${row.scenario.employerHours}, DC=${row.scenario.dcHours}, month=${row.scenario.status}`);
    console.log(`  Next:   ${row.scenario.next}\n`);
  }
  console.log(
    `Upload-ready CSV: ${UPLOAD_FIXTURE}\nUse the BAO Monthly Hours Upload for employer "${employer.name}" and reporting month May 2026. Each CSV SSN was verified through the same bulk lookup used by the wizard. Re-running this command restores all four fixtures.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });