import session from "express-session";
import { logger } from "../logger";
import { storage } from "../storage";
import {
  getSessionIdleTimeoutSettings,
  type SessionIdleTimeoutSettings,
} from "./session-idle-timeout";

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

  private getAcceptedActivityExpireTime(
    settings: SessionIdleTimeoutSettings,
  ): Date {
    const durationMs = settings.enabled
      ? Math.min(this.ttlMs, settings.timeoutMinutes * 60_000)
      : this.ttlMs;
    return new Date(Date.now() + durationMs);
  }

  private isAuthenticated(sess: session.SessionData): boolean {
    return Boolean((sess as any)?.passport?.user);
  }

  private async applyAuthenticatedActivity(
    sid: string,
    sess: session.SessionData,
    settings: SessionIdleTimeoutSettings,
    renew: boolean,
  ): Promise<session.SessionData | null> {
    if (!this.isAuthenticated(sess)) return sess;

    const now = Date.now();
    const previous = Date.parse((sess as any).sessionIdleLastActivityAt ?? "");
    if (
      settings.enabled &&
      Number.isFinite(previous) &&
      now - previous > settings.timeoutMinutes * 60_000
    ) {
      await getStorage().sessions.deleteSession(sid, "idle timeout");
      return null;
    }

    if (!renew) return sess;

    (sess as any).sessionIdleLastActivityAt = new Date(now).toISOString();
    const expire = this.getAcceptedActivityExpireTime(settings);
    sess.cookie.expires = expire;
    await getStorage().sessions.upsertSession(sid, sess, expire);
    return sess;
  }

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    getStorage().sessions.getSessionData(sid)
      .then(async (value: unknown) => {
        const sess = value as session.SessionData | undefined;
        if (!sess) return null;
        const settings = await getSessionIdleTimeoutSettings(getStorage());
        return this.applyAuthenticatedActivity(sid, sess, settings, false);
      })
      .then((sess) => callback(null, sess))
      .catch((err: unknown) => {
        logger.error("Session store get failed", { service: "session-store", error: err instanceof Error ? err.message : String(err) });
        callback(err);
      });
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    getSessionIdleTimeoutSettings(getStorage())
      .then(async (settings) => {
        if ((sess as any).sessionIdleReadOnlyCheck) {
          delete (sess as any).sessionIdleReadOnlyCheck;
          return;
        }
        if (!this.isAuthenticated(sess)) {
          await getStorage().sessions.upsertSession(sid, sess, this.getExpireTime(sess));
          return;
        }
        await this.applyAuthenticatedActivity(sid, sess, settings, true);
      })
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
    getSessionIdleTimeoutSettings(getStorage())
      .then(async (settings) => {
        if ((sess as any).sessionIdleReadOnlyCheck) {
          delete (sess as any).sessionIdleReadOnlyCheck;
          return;
        }
        if (!this.isAuthenticated(sess)) return;
        await this.applyAuthenticatedActivity(sid, sess, settings, true);
      })
      .then(() => callback?.())
      .catch((err: unknown) => {
        logger.error("Session store touch failed", { service: "session-store", error: err instanceof Error ? err.message : String(err) });
        callback?.(err);
      });
  }
}
