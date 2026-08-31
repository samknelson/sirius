/**
 * End-to-end exercise of the worker ratings import wizard (task 1334).
 *
 * Drives the engine class the way the dispatcher does — upload a file, set
 * the column mapping and the identifier kind, validate, process — inside a
 * request context, so the storage logging middleware attributes every rating
 * change to the "running user" exactly as it would in the app.
 *
 * Run: npx tsx scripts/oneoffs/test-1334-ratings-import.ts
 */
import { storage } from "../../server/storage";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import { fileSystemService } from "../../server/services/files";
import { requestContext } from "../../server/middleware/request-context";
import { WorkerRatingsImportWizard } from "../../server/plugins/wizards/engine/types/worker_ratings_import";

const RUNNING_USER = {
  userId: "bf1b01c2-dcd9-4aeb-a562-1cde1f1e3a91",
  userEmail: "sam@clevernamehere.com",
};

/** Worker A: Sirius 2, SSN 008621234, Titan ID X229944. */
const WORKER_A = "199da85e-bbf0-47fc-97b1-2c93c912168c";
/** Worker B: Sirius 1, no SSN, Titan ID X1234. */
const WORKER_B = "da51853b-0ba5-464f-81e7-b394d6c5b104";
const TITAN_ID_TYPE = "44151277-8ef2-4d4b-95ca-2d5c32745438";
const PHYSICAL_RATING = "9a32c3cf-2b4a-44e7-a838-49a905bbfef7";

const feed = new WorkerRatingsImportWizard();
const options = createUnifiedOptionsStorage();

const created: { wizardIds: string[]; ratingTypeIds: string[] } = {
  wizardIds: [],
  ratingTypeIds: [],
};

async function runFile(
  label: string,
  csv: string,
  identifierKind: string,
): Promise<string> {
  const wizard = await storage.wizards.create({
    type: "worker_ratings_import",
    status: "in_progress",
    currentStep: "upload",
    data: {},
  });
  created.wizardIds.push(wizard.id);

  const fileName = `ratings-${label}.csv`;
  const upload = await fileSystemService.upload({
    fileName,
    fileContent: Buffer.from(csv, "utf8"),
    mimeType: "text/csv",
    fileSystemId: "private",
    customPath: `wizards/${wizard.id}/${Date.now()}_${fileName}`,
  });
  await feed.associateFile(wizard.id, {
    fileName,
    storagePath: upload.storagePath,
    mimeType: "text/csv",
    size: upload.size,
    uploadedBy: RUNNING_USER.userId,
    entityType: "wizard",
    entityId: wizard.id,
    fileSystemId: "private",
  });

  const current = await storage.wizards.getById(wizard.id);
  await storage.wizards.update(wizard.id, {
    data: {
      ...((current?.data as Record<string, unknown>) ?? {}),
      hasHeaders: true,
      columnMapping: {
        workerIdentifier: "col_0",
        ratingType: "col_1",
        value: "col_2",
      },
      workerIdentifierKind: identifierKind,
    },
  });

  console.log(`\n===== ${label} (identified by ${identifierKind}) =====`);
  const validation = await feed.validateFeedData(wizard.id);
  console.log(
    `validate: ${validation.totalRows} rows, ${validation.validRows} valid, ${validation.invalidRows} invalid`,
  );
  for (const err of validation.errors) {
    console.log(`  row ${err.rowIndex + 1} [${err.field}]: ${err.message}`);
  }

  const results = await feed.processFeedData(wizard.id);
  console.log(
    `process: set=${results.ratingsSet} cleared=${results.ratingsCleared} unchanged=${results.ratingsUnchanged} skipped=${results.ratingsSkipped}`,
  );
  for (const row of results.rowResults ?? []) {
    console.log(`  row ${row.rowIndex + 1} ${row.status}: ${row.message}`);
  }
  return wizard.id;
}

async function main() {
  // Two rating types sharing a name (ambiguity) and one carrying a Sirius ID.
  const siriusRating = await options.create("worker-rating", {
    name: "E2E Sirius Rating",
    siriusId: "E2E-RT-1",
  });
  const dupA = await options.create("worker-rating", {
    name: "E2E Dup Rating",
  });
  const dupB = await options.create("worker-rating", {
    name: "E2E Dup Rating",
  });
  created.ratingTypeIds.push(siriusRating.id, dupA.id, dupB.id);
  console.log("temp rating types:", siriusRating.id, dupA.id, dupB.id);

  const before = {
    aSirius: await storage.workerRatings.getByWorkerAndRating(
      WORKER_A,
      siriusRating.id,
    ),
    aPhysical: await storage.workerRatings.getByWorkerAndRating(
      WORKER_A,
      PHYSICAL_RATING,
    ),
    bPhysical: await storage.workerRatings.getByWorkerAndRating(
      WORKER_B,
      PHYSICAL_RATING,
    ),
  };
  console.log(
    "before:",
    JSON.stringify({
      aSirius: before.aSirius?.value ?? null,
      aPhysical: before.aPhysical?.value ?? null,
      bPhysical: before.bPhysical?.value ?? null,
    }),
  );

  // Seed a value so the blank-clears case has something to clear.
  await storage.workerRatings.upsert(WORKER_A, PHYSICAL_RATING, 2);

  const mainCsv = [
    "Worker,Rating,Value",
    "2,E2E-RT-1,3", // rating type matched on Sirius ID
    "1,Physical,4", // rating type matched on name (superseded below)
    "2,Physical,", // blank clears
    "999999999,Physical,2", // unknown worker
    "2,E2E Dup Rating,1", // ambiguous rating-type name
    "1,E2E-RT-1,7", // value out of range
    "2,Not A Rating,1", // unknown rating type
    "1,Physical,2", // duplicate of row 2 — this one wins
  ].join("\n");

  await requestContext.run(RUNNING_USER, async () => {
    await runFile("sirius", mainCsv, "sirius");

    // Same file again: everything applicable is already in that state.
    await runFile("sirius-rerun", mainCsv, "sirius");

    await runFile(
      "ssn",
      ["Worker,Rating,Value", "008621234,E2E-RT-1,1"].join("\n"),
      "ssn",
    );
    await runFile(
      "uuid",
      ["Worker,Rating,Value", `${WORKER_B},E2E-RT-1,0`].join("\n"),
      "uuid",
    );
    await runFile(
      "worker-id-type",
      ["Worker,Rating,Value", "X229944,E2E-RT-1,4"].join("\n"),
      `id-type:${TITAN_ID_TYPE}`,
    );
  });

  console.log("\n===== final state =====");
  for (const [label, workerId, ratingId] of [
    ["A / sirius rating", WORKER_A, siriusRating.id],
    ["A / physical", WORKER_A, PHYSICAL_RATING],
    ["B / sirius rating", WORKER_B, siriusRating.id],
    ["B / physical", WORKER_B, PHYSICAL_RATING],
  ] as const) {
    const row = await storage.workerRatings.getByWorkerAndRating(
      workerId,
      ratingId,
    );
    console.log(`  ${label}: ${row ? row.value : "(none)"}`);
  }

  // Restore the ratings this script touched and drop its scratch data.
  await storage.workerRatings.upsert(
    WORKER_A,
    PHYSICAL_RATING,
    before.aPhysical?.value ?? null,
  );
  await storage.workerRatings.upsert(
    WORKER_B,
    PHYSICAL_RATING,
    before.bPhysical?.value ?? null,
  );
  for (const workerId of [WORKER_A, WORKER_B]) {
    await storage.workerRatings.upsert(workerId, siriusRating.id, null);
  }
  for (const id of created.ratingTypeIds) {
    await options.delete("worker-rating", id);
  }
  console.log("\ncleanup done; wizard ids:", created.wizardIds.join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
