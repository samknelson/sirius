import session from "express-session";
import { logger } from "../logger";
import { storage } from "../storage";

const getStorage = () => storage;

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
      .then((sess: unknown) => callback(null, (sess as session.SessionData | undefined) ?? null))
      .catch((err: unknown) => {
        logger.error("Session store get failed", { service: "session-store", error: err instanceof Error ? err.message : String(err) });
        callback(err);
      });
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    getStorage().sessions.upsertSession(sid, sess, this.getExpireTime(sess))
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
