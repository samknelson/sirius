import { getClient } from '../transaction-context';
import { grievanceNameDenorm, type GrievanceNameDenorm } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Storage for the `grievance_name_denorm` payload table — the denormalized
 * display name for a grievance. This is the SOLE writer of the table; rows are
 * maintained exclusively by the `grievance_name_denorm` denorm plugin via
 * {@link replaceForGrievance}.
 */
export interface GrievanceNameDenormStorage {
  /** The denorm row for a grievance, if one exists. */
  getByGrievance(grievanceId: string): Promise<GrievanceNameDenorm | undefined>;
  /**
   * Replace the denorm name row for a grievance: delete any existing row and
   * insert the fresh one. Caller is responsible for wrapping this in a
   * transaction together with the matching `denorm` status upsert so the two
   * stay consistent.
   */
  replaceForGrievance(grievanceId: string, denormId: string, name: string): Promise<void>;
}

export function createGrievanceNameDenormStorage(): GrievanceNameDenormStorage {
  return {
    async getByGrievance(grievanceId: string): Promise<GrievanceNameDenorm | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(grievanceNameDenorm)
        .where(eq(grievanceNameDenorm.grievanceId, grievanceId));
      return row || undefined;
    },

    async replaceForGrievance(grievanceId: string, denormId: string, name: string): Promise<void> {
      const client = getClient();
      await client.delete(grievanceNameDenorm).where(eq(grievanceNameDenorm.grievanceId, grievanceId));
      await client.insert(grievanceNameDenorm).values({ denormId, grievanceId, name });
    },
  };
}
