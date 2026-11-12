import { eq } from "drizzle-orm";
import { variables } from "@shared/schema";
import { db } from "../db";

/**
 * Read committed target configuration directly, without wrapped storage,
 * ambient transaction snapshots, boot flags, caches, or the dev fallback in
 * getSystemMode. Standalone loaders must not arm the app's write lock.
 * Callers treat any read/import failure as a refusal.
 */
export async function hasVerifiedMaintenanceMode(): Promise<boolean> {
  const [row] = await db.select({ value: variables.value })
    .from(variables).where(eq(variables.name, "system_mode"));
  return row?.value === "maintenance";
}
