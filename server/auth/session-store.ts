import session from "express-session";
import { logger } from "../logger";
import { storage } from "../storage";
import { createHash } from "node:crypto";

const getStorage = () => storage;
type ObservedSessionData = session.SessionData & { _presentationObserved?: string };
const observedKey = (sid: string) => createHash("sha256").update(sid).digest("hex");

/**
 * express-session Store backed by the storage layer (storage.sessions.*),
 * replacing connect-pg-simple so all `sessions` table access goes through
 * the usual storage path (Drizzle on the shared db.ts pool).
 *
 * Semantics mirror connect-pg-simple:
 * - The row's `expire` comes from `sess.cookie.expires` when present
 *   (express-session sets it from cookie.maxAge), falling back to now + ttl.
 * - `get` only returns unexpired rows.
 * - `touch` rolls the expiry forward (rolling sessions stay alive).
 * - Expired-row pruning is handled by the `session-prune` cron plugin, not
 *   an in-store interval.
 */
export class StorageSessionStore extends session.Store {
  private readonly ttlMs: number;

  constructor(options: { ttlMs: number }) {
    super();
    this.ttlMs = options.ttlMs;
  }

  private getExpireTime(sess: session.SessionData): Date {
    const expires = sess?.cookie?.expires;
    if (expires) {
      const d = new Date(expires);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date(Date.now() + this.ttlMs);
  }

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    getStorage().sessions.getSessionData(sid)
      .then((sess: unknown) => callback(null, sess
        ? { ...(sess as session.SessionData), _presentationObserved: observedKey(sid) } as ObservedSessionData
        : null))
      .catch((err: unknown) => {
        logger.error("Session store get failed", { service: "session-store", error: err instanceof Error ? err.message : String(err) });
        callback(err);
      });
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    // A loaded session cannot be recreated by a late save after logout/prune.
    // Regenerated authentication SIDs differ and may be initialized normally.
    // Strip the non-secret observation marker before persistence/audit.
    const { _presentationObserved, ...payload } = sess as ObservedSessionData;
    getStorage().sessions.upsertSession(sid, payload, this.getExpireTime(sess),
      _presentationObserved === observedKey(sid))
      .then(() => callback?.())
      .catch((err: unknown) => {
        logger.error("Session store set failed", { service: "session-store", error: err instanceof Error ? err.message : String(err) });
        callback?.(err);
      });
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    getStorage().sessions.deleteSession(sid, "logout")
      .then(() => callback?.())
      .catch((err: unknown) => {
        logger.error("Session store destroy failed", { service: "session-store", error: err instanceof Error ? err.message : String(err) });
        callback?.(err);
      });
  }

  touch(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    getStorage().sessions.touchSession(sid, this.getExpireTime(sess))
      .then(() => callback?.())
      .catch((err: unknown) => {
        logger.error("Session store touch failed", { service: "session-store", error: err instanceof Error ? err.message : String(err) });
        callback?.(err);
      });
  }
}
