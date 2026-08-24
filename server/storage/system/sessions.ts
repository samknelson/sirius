import { createNoopValidator } from '../utils/validation';
import { getClient, runInTransaction } from '../transaction-context';
import { allowInMaintenanceMode } from '../maintenance';
import { sessions } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import type { StorageLoggingConfig } from "../middleware/logging";

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

export interface SessionStorage {
  getSessions(): Promise<SessionWithUser[]>;
  /**
   * Delete one session row. Logged ("Deleted session ..."); the optional
   * `reason` (e.g. 'expired', 'logout') is included in the log description
   * so a session's lifecycle end is attributable. Omitted reason = manual
   * (admin) deletion.
   */
  deleteSession(sid: string, reason?: string): Promise<{ deleted: boolean; userId?: string }>;

  countActiveSessions(): Promise<number>;
  /**
   * express-session store primitives (used by StorageSessionStore in
   * server/auth/session-store.ts). getSessionData/touchSession run on nearly
   * every HTTP request and are intentionally NOT logged. upsertSession is
   * logged ONLY when it actually inserts (session creation) via the
   * shouldLog predicate in sessionLoggingConfig.
   */
  /** The session payload for an unexpired session, or undefined. */
  getSessionData(sid: string): Promise<unknown | undefined>;
  /**
   * Insert or replace a session row. Reports whether a new row was inserted
   * plus the session's owner transition (prior owner captured atomically in
   * the same statement), so ownership changes — login (NONE→user), logout
   * strip (user→NONE), and anomalous user→user swaps — are loggable 1:1.
   */
  upsertSession(sid: string, sess: unknown, expire: Date): Promise<{
    created: boolean;
    oldUserId?: string;
    newUserId?: string;
  }>;
  /** Roll a session's expiry forward. No-op when the row is gone. */
  touchSession(sid: string, expire: Date): Promise<void>;
  /** Sids of expired session rows (for per-session logged pruning). */
  getExpiredSessionSids(): Promise<string[]>;
  /**
   * Delete one session ONLY if it is still expired (atomic `sid AND
   * expire < now()` qualification, so a session renewed between the prune's
   * candidate scan and this delete survives). Logged only when it actually
   * deleted. Returns whether a row was removed and the owner (for log
   * attribution), derived atomically from the deleted row itself.
   */
  deleteExpiredSession(sid: string): Promise<{ deleted: boolean; userId?: string }>;
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

    // Session writes are wrapped in allowInMaintenanceMode: login, rolling
    // expiry, and logout must keep working while the site is in maintenance
    // mode so admins can reach the system-mode escape route. This also
    // (deliberately) covers the session-prune cron (deleteExpiredSession) —
    // pruning during maintenance is harmless and keeps the table tidy.
    async deleteSession(sid: string, _reason?: string): Promise<{ deleted: boolean; userId?: string }> {
      return allowInMaintenanceMode(async () => {
        const client = getClient();
        // RETURNING the deleted row's payload makes owner attribution atomic
        // with the delete: the log can never name a user whose row survived
        // or was concurrently replaced.
        const [row] = await client
          .delete(sessions)
          .where(eq(sessions.sid, sid))
          .returning({ sess: sessions.sess });
        return row ? { deleted: true, userId: sessionUserId(row.sess) } : { deleted: false };
      });
    },

    async countActiveSessions(): Promise<number> {
      const client = getClient();
      const now = new Date();
      const [result] = await client
        .select({ count: sql<number>`count(*)` })
        .from(sessions)
        .where(sql`${sessions.expire} > ${now}`);
      return Number(result?.count ?? 0);
    },

    async getSessionData(sid: string): Promise<unknown | undefined> {
      const client = getClient();
      const now = new Date();
      const [row] = await client
        .select({ sess: sessions.sess })
        .from(sessions)
        .where(sql`${sessions.sid} = ${sid} AND ${sessions.expire} >= ${now}`)
        .limit(1);
      return row?.sess;
    },

    async upsertSession(sid: string, sess: unknown, expire: Date): Promise<{
      created: boolean;
      oldUserId?: string;
      newUserId?: string;
    }> {
      const newUserId = sessionUserId(sess);
      return allowInMaintenanceMode(() => runInTransaction(async () => {
        const client = getClient();
        // The prior owner must be read from the exact row version this upsert
        // overwrites. A snapshot read (plain SELECT or CTE) can diverge from
        // what ON CONFLICT UPDATE actually replaces under concurrency, so:
        // lock the row with FOR UPDATE (which follows the update chain to the
        // latest committed version), then update it while holding the lock.
        // If no row exists, INSERT ... ON CONFLICT DO NOTHING; losing that
        // insert race means a row now exists — retry the locked-update path.
        for (let attempt = 0; attempt < 3; attempt++) {
          const locked = await client.execute(sql`
            SELECT sess #>> '{passport,user,dbUser,id}' AS old_user_id
            FROM sessions WHERE sid = ${sid} FOR UPDATE
          `);
          if (locked.rows.length > 0) {
            await client
              .update(sessions)
              .set({ sess, expire })
              .where(eq(sessions.sid, sid));
            return {
              created: false,
              oldUserId: (locked.rows[0] as any).old_user_id ?? undefined,
              newUserId,
            };
          }
          const inserted = await client
            .insert(sessions)
            .values({ sid, sess, expire })
            .onConflictDoNothing()
            .returning({ sid: sessions.sid });
          if (inserted.length > 0) {
            return { created: true, newUserId };
          }
        }
        throw new Error(`upsertSession: lost insert/update race repeatedly for session`);
      }));
    },

    async touchSession(sid: string, expire: Date): Promise<void> {
      return allowInMaintenanceMode(async () => {
        const client = getClient();
        await client
          .update(sessions)
          .set({ expire })
          .where(eq(sessions.sid, sid));
      });
    },

    async getExpiredSessionSids(): Promise<string[]> {
      const client = getClient();
      const now = new Date();
      const rows = await client
        .select({ sid: sessions.sid })
        .from(sessions)
        .where(sql`${sessions.expire} < ${now}`);
      return rows.map((r) => r.sid);
    },

    async deleteExpiredSession(sid: string): Promise<{ deleted: boolean; userId?: string }> {
      return allowInMaintenanceMode(async () => {
        const client = getClient();
        const now = new Date();
        const [row] = await client
          .delete(sessions)
          .where(sql`${sessions.sid} = ${sid} AND ${sessions.expire} < ${now}`)
          .returning({ sess: sessions.sess });
        return row ? { deleted: true, userId: sessionUserId(row.sess) } : { deleted: false };
      });
    },

  };

  return storage;
}

/**
 * Internal user id out of an express-session payload (passport shape).
 * ONLY the resolved internal account id (dbUser.id) — never claims.sub, which
 * is an external-provider subject and must not become a host_entity_id
 * (invalid reference at best, cross-account misattribution at worst).
 */
function sessionUserId(sess: any): string | undefined {
  return sess?.passport?.user?.dbUser?.id ?? undefined;
}

export const sessionLoggingConfig: StorageLoggingConfig<SessionStorage> = {
  module: 'sessions',
  methods: {
    deleteSession: {
      enabled: true,
      getEntityId: (args) => args[0],
      shouldLog: (_args, result) => result?.deleted === true,
      // Owner comes atomically from the DELETE ... RETURNING result, so the
      // log can never be attributed to a concurrently-replaced session.
      getHostEntityId: (_args, result) => result?.userId,
      getDescription: async (args) =>
        `Deleted session ${args[0]?.substring(0, 8)}...${args[1] ? ` (${args[1]})` : ''}`,
      after: async (args, result) => {
        return {
          deleted: result?.deleted === true,
          metadata: {
            sid: args[0],
            ...(args[1] ? { reason: args[1] } : {}),
          }
        };
      }
    },
    upsertSession: {
      enabled: true,
      // Runs on every session save; log-worthy events are creation and any
      // owner transition (login NONE→user, logout strip user→NONE, anomalous
      // user→user swap). Same-owner data re-saves stay silent. This gives a
      // 1:1 mapping from session state change to log entry — no guessing
      // from ambient request context.
      shouldLog: (_args, result) =>
        result?.created === true || (result?.oldUserId ?? null) !== (result?.newUserId ?? null),
      // Never persist the raw session payload (cookies, passport identity,
      // potentially provider tokens) into the audit log — keep sid + expiry.
      logArgs: (args) => [args[0], "<session payload redacted>", args[2]],
      getEntityId: (args) => args[0],
      // Attribute to the new owner; when the owner departs (→NONE), to the
      // departing user. Anonymous transitions stay unattributed.
      getHostEntityId: (_args, result) => result?.newUserId ?? result?.oldUserId,
      getDescription: async (args, result) => {
        const sid8 = `${args[0]?.substring(0, 8)}...`;
        if (result?.created === true) {
          return result?.newUserId
            ? `Created session ${sid8} for user ${result.newUserId}`
            : `Created session ${sid8}`;
        }
        return `Changed session ${sid8} from ${result?.oldUserId ?? 'NONE'} to ${result?.newUserId ?? 'NONE'}`;
      },
      after: async (args, result) => {
        return {
          created: result?.created === true,
          metadata: {
            sid: args[0],
            oldUserId: result?.oldUserId ?? null,
            newUserId: result?.newUserId ?? null,
          }
        };
      }
    },
    deleteExpiredSession: {
      enabled: true,
      // Atomic expired-only delete used by the prune cron. Only log when a
      // row was actually removed (a renewed session survives silently).
      shouldLog: (_args, result) => result?.deleted === true,
      getEntityId: (args) => args[0],
      // Same atomic owner attribution for cron-driven expiry deletes (no
      // request context exists there at all).
      getHostEntityId: (_args, result) => result?.userId,
      getDescription: async (args) => `Deleted session ${args[0]?.substring(0, 8)}... (expired)`,
      after: async (args, result) => {
        return {
          deleted: result?.deleted === true,
          metadata: {
            sid: args[0],
            reason: 'expired',
          }
        };
      }
    },
  },
};
