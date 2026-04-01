import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BPS_EMPLOYEE_ID_TYPE = "f01cc7f8-158d-4e83-9177-5ae361c6cba6";

interface StewardRow {
  "ID/Badge #": string;
  Email: string;
}

async function importStewards() {
  console.log("Starting steward import...");

  // Read the CSV file
  const csvPath = path.join(__dirname, "../../attached_assets/Steward_List_with_Email_Only_1768524382071.csv");
  const csvContent = fs.readFileSync(csvPath, "utf-8");

  const records: StewardRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Found ${records.length} records in CSV`);

  let emailsUpdated = 0;
  let stewardsCreated = 0;
  let workersNotFound = 0;
  let skippedNoEmail = 0;
  let skippedNoEmployer = 0;
  let skippedNoBargainingUnit = 0;
  const notFoundBadges: string[] = [];

  for (const record of records) {
    const badgeId = record["ID/Badge #"]?.trim();
    const email = record.Email?.trim();

    if (!badgeId) {
      continue;
    }

    if (!email) {
      skippedNoEmail++;
      continue;
    }

    // Find worker by BPS Employee ID
    const workerResult = await db.execute(sql`
      SELECT 
        w.id as worker_id,
        w.contact_id,
        w.bargaining_unit_id,
        w.denorm_home_employer_id,
        c.email as current_email
      FROM workers w
      JOIN worker_ids wi ON wi.worker_id = w.id
      JOIN contacts c ON c.id = w.contact_id
      WHERE wi.type_id = ${BPS_EMPLOYEE_ID_TYPE}
      AND wi.value = ${badgeId}
      LIMIT 1
    `);

    if (workerResult.rows.length === 0) {
      workersNotFound++;
      notFoundBadges.push(badgeId);
      continue;
    }

    const worker = workerResult.rows[0] as any;

    // Update contact email if different
    if (worker.current_email !== email) {
      await db.execute(sql`
        UPDATE contacts 
        SET email = ${email}
        WHERE id = ${worker.contact_id}
      `);
      emailsUpdated++;
    }

    // Check if worker has employer and bargaining unit
    if (!worker.denorm_home_employer_id) {
      skippedNoEmployer++;
      continue;
    }

    if (!worker.bargaining_unit_id) {
      skippedNoBargainingUnit++;
      continue;
    }

    // Check if steward assignment already exists
    const existingAssignment = await db.execute(sql`
      SELECT id FROM worker_steward_assignments
      WHERE worker_id = ${worker.worker_id}
      AND employer_id = ${worker.denorm_home_employer_id}
      AND bargaining_unit_id = ${worker.bargaining_unit_id}
    `);

    if (existingAssignment.rows.length === 0) {
      // Create steward assignment
      await db.execute(sql`
        INSERT INTO worker_steward_assignments (worker_id, employer_id, bargaining_unit_id)
        VALUES (${worker.worker_id}, ${worker.denorm_home_employer_id}, ${worker.bargaining_unit_id})
      `);
      stewardsCreated++;
    }
  }

  console.log("\n=== Import Complete ===");
  console.log(`Emails updated: ${emailsUpdated}`);
  console.log(`Steward assignments created: ${stewardsCreated}`);
  console.log(`Workers not found: ${workersNotFound}`);
  console.log(`Skipped (no email in CSV): ${skippedNoEmail}`);
  console.log(`Skipped (no employer): ${skippedNoEmployer}`);
  console.log(`Skipped (no bargaining unit): ${skippedNoBargainingUnit}`);

  if (notFoundBadges.length > 0 && notFoundBadges.length <= 20) {
    console.log(`\nBadge IDs not found: ${notFoundBadges.join(", ")}`);
  } else if (notFoundBadges.length > 20) {
    console.log(`\nFirst 20 Badge IDs not found: ${notFoundBadges.slice(0, 20).join(", ")}...`);
  }

  process.exit(0);
}

importStewards().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
