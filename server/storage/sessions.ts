import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { sessions, users } from "@shared/schema";
import { eq, gt, desc, sql } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface SessionWithUser {
  sid: string;
  expire: Date;
  userId: string | null;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
}

export interface ActiveUsersStats {
  activeCount: number;
  recentUsers: Array<{
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }>;
}

export interface SessionStorage {
  getSessions(): Promise<SessionWithUser[]>;
  deleteSession(sid: string): Promise<boolean>;
  getActiveUsersStats(limit?: number): Promise<ActiveUsersStats>;
}

export function createSessionStorage(): SessionStorage {
  const storage: SessionStorage = {
    async getSessions(): Promise<SessionWithUser[]> {
      const client = getClient();
      const now = new Date();
      const result = await client.execute(sql`
        SELECT 
          s.sid,
          s.expire,
          u.id as user_id,
          u.email as user_email,
          u.first_name as user_first_name,
          u.last_name as user_last_name
        FROM sessions s
        LEFT JOIN users u ON u.id::text = (s.sess->'passport'->'user'->'dbUser'->>'id')
        WHERE s.expire > ${now}
        ORDER BY s.expire DESC
      `);
      
      return (result.rows as any[]).map(row => ({
        sid: row.sid,
        expire: new Date(row.expire),
        userId: row.user_id,
        userEmail: row.user_email,
        userFirstName: row.user_first_name,
        userLastName: row.user_last_name,
      }));
    },

    async deleteSession(sid: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(sessions)
        .where(eq(sessions.sid, sid))
        .returning();
      return result.length > 0;
    },

    async getActiveUsersStats(limit: number = 4): Promise<ActiveUsersStats> {
      const client = getClient();
      const now = new Date();
      
      const countResult = await client.execute(sql`
        SELECT COUNT(DISTINCT u.id) as count
        FROM sessions s
        INNER JOIN users u ON u.id::text = (s.sess->'passport'->'user'->'dbUser'->>'id')
        WHERE s.expire > ${now}
      `);
      
      const activeCount = parseInt((countResult.rows[0] as any)?.count || '0', 10);
      
      const recentResult = await client.execute(sql`
        SELECT DISTINCT ON (u.id)
          u.id as user_id,
          u.email as user_email,
          u.first_name as user_first_name,
          u.last_name as user_last_name,
          u.last_login as last_login
        FROM sessions s
        INNER JOIN users u ON u.id::text = (s.sess->'passport'->'user'->'dbUser'->>'id')
        WHERE s.expire > ${now}
        ORDER BY u.id, u.last_login DESC NULLS LAST
        LIMIT ${limit}
      `);
      
      const recentUsers = (recentResult.rows as any[]).map(row => ({
        id: row.user_id,
        email: row.user_email,
        firstName: row.user_first_name,
        lastName: row.user_last_name,
      }));
      
      return { activeCount, recentUsers };
    },
  };

  return storage;
}

export const sessionLoggingConfig: StorageLoggingConfig<SessionStorage> = {
  module: 'sessions',
  methods: {
    deleteSession: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args) => `Deleted session ${args[0]?.substring(0, 8)}...`,
      after: async (args, result) => {
        return {
          deleted: result,
          metadata: {
            sid: args[0],
          }
        };
      }
    },
  },
};
