import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "../auth";
import { requireAccess } from "../services/access-policy-evaluator";
import { getClient, runInTransaction } from "../storage/transaction-context";
import { sql } from "drizzle-orm";

const cleanupCategorySchema = z.enum([
  "workers",
  "contacts",
  "employers", 
  "ledger",
  "events",
  "dispatch",
  "edls",
  "communications",
  "wizards",
]);

type CleanupCategory = z.infer<typeof cleanupCategorySchema>;

const cleanupSchema = z.object({
  categories: z.array(cleanupCategorySchema).min(1),
  confirmed: z.boolean(),
});

interface CategoryCounts {
  category: CleanupCategory;
  tables: { name: string; count: number }[];
  totalRecords: number;
}

async function getTableCount(tableName: string): Promise<number> {
  const db = getClient();
  const result = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM "${tableName}"`));
  return parseInt(result.rows[0].count as string) || 0;
}

async function tableExists(tableName: string): Promise<boolean> {
  const db = getClient();
  const result = await db.execute(sql.raw(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = '${tableName}'
    ) as exists
  `));
  return result.rows[0].exists === true;
}

async function safeGetTableCount(tableName: string): Promise<number> {
  try {
    const exists = await tableExists(tableName);
    if (!exists) return 0;
    return await getTableCount(tableName);
  } catch (error) {
    console.error(`Error checking table ${tableName}:`, error);
    throw error;
  }
}

const categoryTables: Record<CleanupCategory, string[]> = {
  workers: [
    "trust_wmb_scan_queue",
    "trust_wmb_scan_status",
    "trust_wmb",
    "worker_skills",
    "worker_certifications",
    "worker_ratings",
    "worker_dispatch_elig_denorm",
    "worker_dispatch_status",
    "worker_dispatch_dnc",
    "worker_dispatch_hfe",
    "worker_bans",
    "worker_wsh",
    "worker_msh",
    "worker_hours",
    "worker_ids",
    "worker_steward_assignments",
    "event_participants",
    "bookmarks",
    "workers",
  ],
  contacts: [
    "contact_phone",
    "contact_postal",
    "contacts",
  ],
  employers: [
    "cardchecks",
    "employer_policy_history",
    "employer_contacts",
    "sitespecific_btu_employer_map",
    "sitespecific_btu_csg",
    "employers",
  ],
  ledger: [
    "ledger",
    "ledger_payments",
    "ledger_ea",
    "ledger_stripe_paymentmethods",
  ],
  events: [
    "event_participants",
    "event_occurrences",
    "events",
  ],
  dispatch: [
    "dispatches",
    "dispatch_jobs",
    "worker_dispatch_elig_denorm",
    "worker_dispatch_status",
    "worker_dispatch_dnc",
    "worker_dispatch_hfe",
  ],
  edls: [
    "edls_assignments",
    "edls_crews",
    "edls_sheets",
  ],
  communications: [
    "comm_inapp",
    "comm_postal",
    "comm_postal_optin",
    "comm_email",
    "comm_email_optin",
    "comm_sms",
    "comm_sms_optin",
    "comm",
  ],
  wizards: [
    "wizard_report_data",
    "wizard_feed_mappings",
    "wizard_employer_monthly",
    "wizards",
  ],
};

const categoryLabels: Record<CleanupCategory, string> = {
  workers: "Workers (includes hours, benefits, skills, certifications, bans, history)",
  contacts: "Contacts (includes phone numbers, addresses)",
  employers: "Employers (includes contacts, policies, card checks)",
  ledger: "Ledger (accounts, payments, transactions)",
  events: "Events (events, occurrences, participants)",
  dispatch: "Dispatch (jobs, dispatches, worker status)",
  edls: "EDLS (sheets, crews, assignments)",
  communications: "Communications (messages, opt-ins)",
  wizards: "Wizards (import/export records, reports)",
};

const categoryDependencies: Record<CleanupCategory, CleanupCategory[]> = {
  workers: [],
  contacts: ["workers"],
  employers: [],
  ledger: [],
  events: [],
  dispatch: [],
  edls: [],
  communications: [],
  wizards: [],
};

async function getCategoryCounts(categories: CleanupCategory[]): Promise<CategoryCounts[]> {
  const results: CategoryCounts[] = [];
  const countedTables = new Set<string>();

  for (const category of categories) {
    const tables = categoryTables[category];
    const tableCounts: { name: string; count: number }[] = [];
    let totalRecords = 0;

    for (const table of tables) {
      if (countedTables.has(table)) continue;
      countedTables.add(table);
      
      const count = await safeGetTableCount(table);
      if (count > 0) {
        tableCounts.push({ name: table, count });
        totalRecords += count;
      }
    }

    results.push({
      category,
      tables: tableCounts,
      totalRecords,
    });
  }

  return results;
}

async function exportCategoryData(categories: CleanupCategory[]): Promise<Record<string, any[]>> {
  const exportedData: Record<string, any[]> = {};
  const exportedTables = new Set<string>();

  for (const category of categories) {
    const tables = categoryTables[category];
    
    for (const table of tables) {
      if (exportedTables.has(table)) continue;
      exportedTables.add(table);
      
      const exists = await tableExists(table);
      if (!exists) continue;
      
      const db = getClient();
      try {
        const result = await db.execute(sql.raw(`SELECT * FROM "${table}"`));
        if (result.rows.length > 0) {
          exportedData[table] = result.rows as any[];
        }
      } catch (error) {
        console.error(`Error exporting table ${table}:`, error);
      }
    }
  }

  return exportedData;
}

async function performCleanup(categories: CleanupCategory[]): Promise<{ category: CleanupCategory; deletedRecords: number }[]> {
  const tablesToDelete = new Set<string>();
  const tableToCategory = new Map<string, CleanupCategory>();
  
  for (const category of categories) {
    for (const table of categoryTables[category]) {
      if (!tablesToDelete.has(table)) {
        tablesToDelete.add(table);
        tableToCategory.set(table, category);
      }
    }
  }

  const orderedTables: string[] = [];
  for (const category of categories) {
    for (const table of categoryTables[category]) {
      if (tablesToDelete.has(table)) {
        orderedTables.push(table);
        tablesToDelete.delete(table);
      }
    }
  }

  const categoryDeletedCounts = new Map<CleanupCategory, number>();
  for (const category of categories) {
    categoryDeletedCounts.set(category, 0);
  }

  await runInTransaction(async () => {
    const db = getClient();
    
    for (const table of orderedTables) {
      const exists = await tableExists(table);
      if (!exists) continue;
      
      const countBefore = await getTableCount(table);
      
      try {
        await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
      } catch (error: any) {
        console.error(`Error truncating table ${table}:`, error);
        throw new Error(`Failed to truncate table ${table}: ${error.message}`);
      }
      
      const category = tableToCategory.get(table);
      if (category) {
        const currentCount = categoryDeletedCounts.get(category) || 0;
        categoryDeletedCounts.set(category, currentCount + countBefore);
      }
    }
  });

  const results: { category: CleanupCategory; deletedRecords: number }[] = [];
  for (const category of categories) {
    results.push({
      category,
      deletedRecords: categoryDeletedCounts.get(category) || 0,
    });
  }

  return results;
}

export function registerDataCleanupRoutes(app: Express) {
  app.get(
    "/api/admin/data-cleanup/categories",
    isAuthenticated,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const categories = Object.entries(categoryLabels).map(([key, label]) => ({
          id: key,
          label,
          dependencies: categoryDependencies[key as CleanupCategory],
        }));
        res.json(categories);
      } catch (error: any) {
        console.error("Error listing cleanup categories:", error);
        res.status(500).json({ message: error.message || "Failed to list categories" });
      }
    }
  );

  app.post(
    "/api/admin/data-cleanup/preview",
    isAuthenticated,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { categories } = z.object({ categories: z.array(cleanupCategorySchema).min(1) }).parse(req.body);
        const counts = await getCategoryCounts(categories);
        res.json(counts);
      } catch (error: any) {
        console.error("Error previewing cleanup:", error);
        if (error.name === 'ZodError') {
          res.status(400).json({ message: "Invalid request data", errors: error.errors });
        } else {
          res.status(500).json({ message: error.message || "Failed to preview cleanup" });
        }
      }
    }
  );

  app.post(
    "/api/admin/data-cleanup/export",
    isAuthenticated,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { categories } = z.object({ categories: z.array(cleanupCategorySchema).min(1) }).parse(req.body);
        const exportData = await exportCategoryData(categories);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `data-export-${timestamp}.json`;
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json({
          exportedAt: new Date().toISOString(),
          categories,
          data: exportData,
        });
      } catch (error: any) {
        console.error("Error exporting data:", error);
        if (error.name === 'ZodError') {
          res.status(400).json({ message: "Invalid request data", errors: error.errors });
        } else {
          res.status(500).json({ message: error.message || "Failed to export data" });
        }
      }
    }
  );

  app.post(
    "/api/admin/data-cleanup/execute",
    isAuthenticated,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { categories, confirmed } = cleanupSchema.parse(req.body);
        
        if (!confirmed) {
          return res.status(400).json({ message: "Cleanup must be confirmed" });
        }

        const results = await performCleanup(categories);
        res.json({
          success: true,
          results,
          message: `Successfully cleaned up ${results.reduce((sum, r) => sum + r.deletedRecords, 0)} records across ${categories.length} categories`,
        });
      } catch (error: any) {
        console.error("Error executing cleanup:", error);
        if (error.name === 'ZodError') {
          res.status(400).json({ message: "Invalid request data", errors: error.errors });
        } else {
          res.status(500).json({ message: error.message || "Failed to execute cleanup" });
        }
      }
    }
  );
}
