/**
 * Script to clear ledger table before schema migration.
 * 
 * IMPORTANT: Run this script BEFORE running `npm run db:push` when migrating
 * to a schema with the new charge_plugin and charge_plugin_key columns.
 * 
 * Usage: npx tsx scripts/db-clear-ledger.ts
 * 
 * This is required because the new columns are NOT NULL and have no defaults,
 * so they cannot be added to a table with existing data.
 */

import { db } from "../server/db";
import { ledger } from "../shared/schema";
import { sql } from "drizzle-orm";

async function clearLedgerTable() {
  console.log("Clearing ledger table before schema migration...");
  console.log("This is required for the charge_plugin / charge_plugin_key column addition.");
  
  try {
    const result = await db.delete(ledger);
    console.log("Ledger table cleared successfully");
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not exist")) {
      console.log("Ledger table does not exist yet, skipping clear");
    } else {
      try {
        await db.execute(sql`DELETE FROM ledger`);
        console.log("Ledger table cleared using raw SQL");
      } catch (rawError) {
        console.log("Ledger table does not exist or cannot be cleared, continuing...");
      }
    }
  }
  
  process.exit(0);
}

clearLedgerTable();
