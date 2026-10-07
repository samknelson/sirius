import { sessionHistory, type InsertSessionHistory } from "@shared/schema";
import { and, asc, count, desc, eq, lt, sql } from "drizzle-orm";
import { getClient, runInTransaction } from "../transaction-context";
import { createHash } from "node:crypto";
import { normalizeSessionIp } from "../../auth/session-ip";
import type { SignInIpDecision } from "../../services/event-bus";
import { sessionHistoryPagingSchema, type UserSessionHistoryPage } from "@shared/session-history";
import { sessionHistoryDataObject } from "@shared/session-device";

export interface SessionHistoryStorage {
  create(entry: InsertSessionHistory): Promise<void>;
  recordSignIn(entry: InsertSessionHistory & { id: string; userId: string; authenticationSessionReference?: string }): Promise<SignInIpDecision>;
  countBefore(cutoff: Date): Promise<number>;
  getExpiredIds(cutoff: Date, limit: number): Promise<string[]>;
  deleteExpired(id: string, cutoff: Date): Promise<boolean>;
  getUserPage(userId: string, paging: { page: number; pageSize: number }): Promise<UserSessionHistoryPage>;
}

/**
 * Internal lifecycle observations, not directly maintained records.
 * Deliberately no storage logging wrapper/configuration or entity metadata.
 */
export function createSessionHistoryStorage(): SessionHistoryStorage {
  // Serialize comparison + insertion per account across processes. Ordinary
  // observations take the same lock so they cannot interleave the comparison.
  async function lockUser(userId: string) {
    await getClient().execute(sql`SET LOCAL lock_timeout = '2s'`);
    await getClient().execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`session-history:${userId}`}, 0))`);
  }
  return {
    async create(entry) {
      await runInTransaction(async () => {
        if (entry.userId) await lockUser(entry.userId);
        await getClient().insert(sessionHistory).values({ ...entry, ip: normalizeSessionIp(entry.ip) });
      });
    },
    async recordSignIn(entry) {
      return runInTransaction(async () => {
        await lockUser(entry.userId);
        const { authenticationSessionReference, ...rowEntry } = entry;
        const reference = authenticationSessionReference && /^[a-f0-9]{64}$/.test(authenticationSessionReference)
          ? authenticationSessionReference : undefined;
        const ip = normalizeSessionIp(entry.ip);
        // Clerk can establish several app sessions from ONE upstream sign-in.
        // Correlate them in this existing history table using a non-bearer hash,
        // so automatic restoration/renewal is not a fresh sign-in.
        const restored = reference ? (await getClient().select({ id: sessionHistory.id })
          .from(sessionHistory).where(and(
            eq(sessionHistory.userId, entry.userId),
            sql`${sessionHistory.data}->>'authenticationSessionReference' = ${reference}`,
          )).limit(1)).length > 0 : false;
        const previous = await getClient().selectDistinct({ ip: sessionHistory.ip })
          .from(sessionHistory).where(eq(sessionHistory.userId, entry.userId));
        const known = new Set(previous.map(row => normalizeSessionIp(row.ip)).filter((value): value is string => !!value));
        const decision: SignInIpDecision = restored ? "restored-session" : !ip ? "missing-ip"
          : known.size === 0 ? "baseline" : known.has(ip) ? "known-ip" : "new-ip";
        // The event occurrence id is a non-bearer UUID, not the cookie SID.
        await getClient().insert(sessionHistory).values({
          ...rowEntry, ip,
          data: reference ? {
            ...sessionHistoryDataObject(rowEntry.data),
            authenticationSessionReference: reference,
          } : rowEntry.data,
        });
        return decision;
      });
    },
    async countBefore(cutoff) {
      const [row] = await getClient()
        .select({ count: sql<number>`count(*)` })
        .from(sessionHistory)
        .where(lt(sessionHistory.timestamp, cutoff));
      return Number(row.count);
    },
    async getExpiredIds(cutoff, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error("Session history cleanup limit must be between 1 and 1000");
      }
      const rows = await getClient()
        .select({ id: sessionHistory.id })
        .from(sessionHistory)
        .where(lt(sessionHistory.timestamp, cutoff))
        .orderBy(asc(sessionHistory.timestamp), asc(sessionHistory.id))
        .limit(limit);
      return rows.map((row) => row.id);
    },
    async deleteExpired(id, cutoff) {
      const rows = await getClient()
        .delete(sessionHistory)
        .where(and(eq(sessionHistory.id, id), lt(sessionHistory.timestamp, cutoff)))
        .returning({ id: sessionHistory.id });
      return rows.length > 0;
    },
    async getUserPage(userId, paging) {
      const { page, pageSize } = sessionHistoryPagingSchema.parse(paging);
      const client = getClient();
      const scope = eq(sessionHistory.userId, userId);
      const [{ total }] = await client.select({ total: count() }).from(sessionHistory).where(scope);
      const rows = await client.select({
        id: sessionHistory.id,
        timestamp: sessionHistory.timestamp,
        ip: sessionHistory.ip,
        sid: sessionHistory.sid,
        // Extract only a correctly typed public descriptive field, not the
        // full JSON (which includes private authentication correlation).
        userAgent: sql<string | null>`CASE
          WHEN jsonb_typeof(${sessionHistory.data} #> '{device,user_agent}') = 'string'
          THEN NULLIF(${sessionHistory.data} #>> '{device,user_agent}', '')
          ELSE NULL END`,
      }).from(sessionHistory).where(scope)
        .orderBy(desc(sessionHistory.timestamp), desc(sessionHistory.id))
        .limit(pageSize).offset((page - 1) * pageSize);
      return {
        // Never return cookie identifiers or the arbitrary stored JSON.
        entries: rows.map(row => ({
          id: row.id,
          timestamp: row.timestamp.toISOString(),
          ip: row.ip,
          userAgent: row.userAgent,
          sessionReference: createHash("sha256").update("session-history-reference:").update(row.sid).digest("hex"),
        })),
        total, page, pageSize, totalPages: Math.ceil(total / pageSize),
      };
    },
  };
}
