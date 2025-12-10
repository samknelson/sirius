import { db } from "../server/db";
import { employers, contacts, employerContacts, contactPostal } from "../shared/schema";
import { eq } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import * as fs from "fs";

const LOCATION_CONTACT_TYPE_ID = "6fd7a7ea-d85d-448e-bc5d-c75a9e11566c";

interface LocationRow {
  Type: string;
  Shops: string;
  Phone: string;
  Fax: string;
  Email: string;
  "Address Line 1": string;
  City: string;
  State: string;
  Zip: string;
}

function normalizeSchoolName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[,'"]/g, "");
}

async function importLocations() {
  console.log("Starting location contacts import...\n");

  // Read and parse CSV
  const csvContent = fs.readFileSync("attached_assets/btu-locations_1765395360897.csv", "utf-8");
  const rows: LocationRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Found ${rows.length} location rows to import\n`);

  // Fetch all employers
  const allEmployers = await db.select().from(employers);
  console.log(`Found ${allEmployers.length} employers in database\n`);

  // Build normalized name lookup
  const employerMap = new Map<string, { id: string; name: string }>();
  for (const emp of allEmployers) {
    const normalized = normalizeSchoolName(emp.name);
    employerMap.set(normalized, { id: emp.id, name: emp.name });
  }

  const results = {
    matched: 0,
    unmatched: [] as string[],
    created: 0,
    errors: [] as string[],
  };

  for (const row of rows) {
    const shopName = row.Shops.trim();
    if (!shopName) continue;

    const normalizedName = normalizeSchoolName(shopName);
    const employer = employerMap.get(normalizedName);

    if (!employer) {
      results.unmatched.push(shopName);
      continue;
    }

    results.matched++;

    try {
      // Create contact with display name as shop name (location)
      const [contact] = await db
        .insert(contacts)
        .values({
          displayName: `${shopName} Location`,
          given: null,
          family: null,
          email: row.Email?.trim() || null,
        })
        .returning();

      // Create employer contact link
      await db.insert(employerContacts).values({
        employerId: employer.id,
        contactId: contact.id,
        contactTypeId: LOCATION_CONTACT_TYPE_ID,
      });

      // Create address if provided
      if (row["Address Line 1"]?.trim()) {
        await db.insert(contactPostal).values({
          contactId: contact.id,
          street: row["Address Line 1"].trim(),
          city: row.City?.trim() || "",
          state: row.State?.trim() || "MA",
          postalCode: row.Zip?.trim() || "",
          country: "USA",
          isPrimary: true,
          isActive: true,
        });
      }

      results.created++;
      console.log(`Created: ${shopName} -> ${employer.name}`);
    } catch (error: any) {
      results.errors.push(`${shopName}: ${error.message}`);
    }
  }

  console.log("\n=== Import Summary ===");
  console.log(`Matched employers: ${results.matched}`);
  console.log(`Contacts created: ${results.created}`);
  console.log(`Unmatched schools: ${results.unmatched.length}`);
  
  if (results.unmatched.length > 0) {
    console.log("\nUnmatched schools:");
    for (const name of results.unmatched) {
      console.log(`  - ${name}`);
    }
  }

  if (results.errors.length > 0) {
    console.log("\nErrors:");
    for (const err of results.errors) {
      console.log(`  - ${err}`);
    }
  }

  process.exit(0);
}

importLocations().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
