import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as readline from "readline";

async function confirm(message: string): Promise<boolean> {
  if (process.argv.includes("--force") || process.argv.includes("-f")) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "yes");
    });
  });
}

async function getCount(tableName: string): Promise<number> {
  const result = await db.execute(sql.raw(`SELECT COUNT(*)::int as count FROM ${tableName}`));
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return Number(row?.count ?? 0);
}

interface TableGroup {
  label: string;
  tables: string[];
}

const TABLE_GROUPS: TableGroup[] = [
  {
    label: "Communications",
    tables: [
      "comm_inapp",
      "comm_postal_optin",
      "comm_postal",
      "comm_email_optin",
      "comm_email",
      "comm_sms_optin",
      "comm_sms",
      "comm",
    ],
  },
  {
    label: "EDLS data",
    tables: [
      "edls_assignments",
      "edls_crews",
      "edls_sheets",
    ],
  },
  {
    label: "Dispatch data",
    tables: [
      "dispatches",
      "dispatch_jobs",
      "worker_dispatch_elig_denorm",
      "worker_dispatch_status",
      "worker_dispatch_dnc",
      "worker_dispatch_hfe",
      "worker_dispatch_eba",
    ],
  },
  {
    label: "Wizards",
    tables: [
      "wizard_report_data",
      "wizard_feed_mappings",
      "wizard_employer_monthly",
      "wizards",
    ],
  },
  {
    label: "Ledger entries",
    tables: [
      "ledger",
      "ledger_payments",
      "ledger_ea",
      "ledger_stripe_paymentmethods",
    ],
  },
  {
    label: "Events",
    tables: [
      "event_participants",
      "event_occurrences",
      "events",
    ],
  },
  {
    label: "Cardchecks",
    tables: [
      "cardchecks",
      "cardcheck_definitions",
    ],
  },
  {
    label: "BTU site-specific data",
    tables: [
      "btu_territory_workers",
      "btu_territory_reps",
      "btu_territories",
      "sitespecific_btu_employer_map",
      "sitespecific_btu_csg",
    ],
  },
  {
    label: "Worker data",
    tables: [
      "worker_steward_assignments",
      "worker_certifications",
      "worker_skills",
      "worker_ratings",
      "worker_ids",
      "worker_wsh",
      "worker_msh",
      "worker_hours",
      "worker_bans",
      "workers",
    ],
  },
  {
    label: "Employer operational data",
    tables: [
      "employer_policy_history",
      "employer_contacts",
      "policies",
      "bargaining_units",
    ],
  },
  {
    label: "Contacts",
    tables: [
      "trust_provider_contacts",
      "contact_postal",
      "contact_phone",
      "contacts",
    ],
  },
  {
    label: "WMB data",
    tables: [
      "trust_wmb_scan_queue",
      "trust_wmb_scan_status",
      "trust_wmb",
    ],
  },
  {
    label: "Files and e-signatures",
    tables: [
      "esigs",
      "files",
    ],
  },
  {
    label: "Logs and cron runs",
    tables: [
      "winston_logs",
      "cron_job_runs",
    ],
  },
  {
    label: "Bookmarks and flood events",
    tables: [
      "bookmarks",
      "flood",
    ],
  },
];

async function resetProductionData(): Promise<void> {
  console.log("=== PRODUCTION DATA RESET ===");
  console.log("");
  console.log("This script will DELETE the following data:");
  console.log("  - Workers (and all related: hours, bans, certs, skills, ratings, IDs, WSH, MSH)");
  console.log("  - Contacts (and phone numbers, postal addresses)");
  console.log("  - Employer contacts, policy history, policies, bargaining units");
  console.log("  - Dispatch data (jobs, dispatches, status, DNC, HFE, EBA, eligibility denorm)");
  console.log("  - EDLS data (sheets, crews, assignments)");
  console.log("  - Ledger entries (ledger, payments, EA links, stripe payment methods)");
  console.log("  - Wizards (all wizard data, feed mappings, report data, employer monthly)");
  console.log("  - Communications (comm, SMS, email, postal, in-app, optins)");
  console.log("  - Events (events, occurrences, participants)");
  console.log("  - Files & E-signatures");
  console.log("  - Logs (winston logs, cron job runs)");
  console.log("  - WMB data (trust_wmb, scan status, scan queue)");
  console.log("  - Cardchecks & definitions");
  console.log("  - BTU site-specific data (CSG, employer map, territories)");
  console.log("  - Worker steward assignments");
  console.log("  - Bookmarks & flood events");
  console.log("");
  console.log("The following will be PRESERVED:");
  console.log("  - Users, auth identities, sessions");
  console.log("  - Roles, user roles, role permissions");
  console.log("  - Employers (the employer records themselves)");
  console.log("  - Variables");
  console.log("  - Trust providers, trust benefits (trust provider contacts are deleted with contacts)");
  console.log("  - Ledger accounts (the account definitions)");
  console.log("  - Charge plugin configs");
  console.log("  - All options/* tables (gender, types, departments, classifications, etc.)");
  console.log("  - Cron job definitions (but runs are cleared)");
  console.log("  - Web service bundles & clients");
  console.log("");

  const confirmed = await confirm(
    "Type 'yes' to confirm this destructive operation: "
  );

  if (!confirmed) {
    console.log("Reset cancelled.");
    process.exit(0);
  }

  console.log("\nCollecting row counts...\n");

  try {
    const allTables: string[] = [];
    const skippedTables: string[] = [];
    const counts: Record<string, number> = {};

    for (const group of TABLE_GROUPS) {
      for (const table of group.tables) {
        try {
          counts[table] = await getCount(table);
          allTables.push(table);
        } catch {
          skippedTables.push(table);
        }
      }
    }

    if (skippedTables.length > 0) {
      console.log(`\n  Skipping ${skippedTables.length} table(s) not found in database: ${skippedTables.join(', ')}`);
    }

    for (const group of TABLE_GROUPS) {
      const existingInGroup = group.tables.filter(t => t in counts);
      const details = existingInGroup
        .filter(t => counts[t] > 0)
        .map(t => `${t}: ${counts[t]}`)
        .join(', ');
      const totalInGroup = existingInGroup.reduce((sum, t) => sum + counts[t], 0);
      if (details) {
        console.log(`  ${group.label}: ${totalInGroup} rows (${details})`);
      } else {
        console.log(`  ${group.label}: 0 rows`);
      }
    }

    const grandTotal = Object.values(counts).reduce((sum, c) => sum + c, 0);
    console.log(`\n  Total rows to delete: ${grandTotal}`);

    console.log("\nClearing FK references from preserved tables...");
    await db.execute(sql`UPDATE employers SET denorm_policy_id = NULL WHERE denorm_policy_id IS NOT NULL`);
    console.log("  [OK] Cleared employers.denorm_policy_id");

    console.log("\nExecuting TRUNCATE...");
    await db.execute(sql.raw(
      `TRUNCATE TABLE ${allTables.join(', ')} RESTART IDENTITY`
    ));
    console.log("  [OK] All operational tables truncated");

    console.log("\nResetting sequences...");
    await db.execute(sql`SELECT setval('employers_sirius_id_seq', COALESCE((SELECT MAX(sirius_id) FROM employers), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('workers_sirius_id_seq', 1, false)`);
    console.log("  [OK] Sequences reset");

    console.log("\n=== PRODUCTION DATA RESET COMPLETE ===");
    console.log("Worker data, transactions, and operational records have been cleared.");
    console.log("Employers, users, roles, options, and system configuration are preserved.");

  } catch (error) {
    console.error("\nERROR: Reset failed:", error);
    console.error("The database may be in an inconsistent state.");
    process.exit(1);
  }

  process.exit(0);
}

resetProductionData();
