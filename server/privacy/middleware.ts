import type { Request, RequestHandler } from "express";
import type { AdvisoryLockHandle } from "../storage/advisory-lock";
import { readMaskState, projectTrainingPerson, type MaskPolicy } from "@shared/privacy/mask-mode";
import { randomUUID } from "node:crypto";
import { maskModePage, maskModeScript } from "./page";

export interface MaskModeDependencies {
  component(): Promise<{ enabled: boolean; epoch: string | null }>;
  acquire(sid: string, exclusive: boolean): Promise<AdvisoryLockHandle | null>;
  read(sid: string): Promise<unknown>;
  transition(sid: string, expected: number, mode: "on" | "off"): Promise<MaskPolicy | null>;
  permissions(req: Request, authoritativeSession: unknown): Promise<{ canToggle: boolean; canRead: boolean }>;
  people(): Promise<Array<{ birthDate: string | null }>>;
}

const STATE = "/api/mask-mode/state";
const PEOPLE = "/api/mask-mode/people";
const LOGOUT = "/api/mask-mode/logout";
const CONTROL_PATHS = new Set(["/mask-mode", "/mask-mode/client.js", STATE, PEOPLE, LOGOUT]);
const READ_METHODS = new Set(["GET", "HEAD"]);
const REFUSAL = { code: "mask_mode_refused", message: "Unavailable in strict Mask Mode. Normal content and actions are blocked." };
export const PRESENTATION_BOOTSTRAP = "/api/components/presentation";
const REAUTH_PAGE = '<!doctype html><html><head><title>Sign in again</title></head><body><h1>Protected session ended</h1><p>Stop recording. Mask Mode was disabled or its configuration changed. Sign out, then sign in again before using normal content.</p><a href="/api/logout">Sign out</a></body></html>';

function hasSessionIdentity(req: Request): boolean {
  return Boolean(req.user || (req.session as any)?.passport?.user);
}

/** Only bundled/source code assets, never uploads, public files or config APIs. */
function isOffCodeAsset(req: Request): boolean {
  return READ_METHODS.has(req.method) && (
    /^\/(?:src|node_modules\/\.vite|@vite|@id)\//.test(req.path) ||
    req.path === "/@react-refresh" ||
    /^\/assets\/[^/]+\.(?:js|css|woff2?)$/.test(req.path)
  );
}

export function createMaskModeMiddleware(deps: MaskModeDependencies): RequestHandler {
  return async (req, res, next) => {
    const control = CONTROL_PATHS.has(req.path);
    const identity = hasSessionIdentity(req);
    const loadedPolicy = (req.session as any)?.maskMode;
    // Anonymous/no-cookie links are outside session protection. Never claim
    // this middleware revokes previously issued public URLs.
    const bootstrap = req.path === PRESENTATION_BOOTSTRAP && req.method === "GET";
    const maskPath = req.path === "/mask-mode" || req.path.startsWith("/mask-mode/") ||
      req.path.startsWith("/api/mask-mode/");
    if (!identity && loadedPolicy === undefined && !maskPath && !bootstrap) return next();

    res.setHeader("Cache-Control", "no-store, private, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    let lease: AdvisoryLockHandle | null = null;
    const refuse = (status = 423) => res.status(status).json(REFUSAL);
    try {
      let component = await deps.component();
      const needsReauthentication = (session: any) => session?.maskModeRevoked === true ||
        (readMaskState(session?.maskMode).mode === "on" &&
          (!component.enabled || session?.maskModeEpoch !== component.epoch));
      const reauthenticate = () => {
        res.setHeader("X-Mask-Mode", "unknown");
        if (req.path === "/api/logout") {
          return req.session.destroy(error => {
            if (error) { refuse(503); return; }
            res.clearCookie("connect.sid", { path: "/" });
            res.redirect(303, "/");
          });
        }
        return READ_METHODS.has(req.method) && !req.path.startsWith("/api/")
          ? res.status(401).type("html").send(REAUTH_PAGE)
          : res.status(401).json({ code: "reauth_required", message: "Protected session ended. Stop recording, sign out and sign in again." });
      };
      // No presentation leases or guard headers on ordinary disabled sessions.
      // The authoritative reread is the minimal revocation fence for a request
      // whose session middleware loaded before a concurrent disable committed.
      if (!component.enabled) {
        const current = identity || loadedPolicy !== undefined ? await deps.read(req.sessionID) : undefined;
        if (needsReauthentication(current) || needsReauthentication(req.session)) return reauthenticate();
        if (bootstrap) return res.json({ maskModeEnabled: false });
        if (req.path === "/mask-mode") return res.status(404).type("html").send(
          '<!doctype html><html><head><title>Mask Mode unavailable</title></head><body><h1>Mask Mode is disabled</h1><p>An administrator must enable the Mask Mode component before this feature is available. Stop recording before returning to the application.</p><a href="/">Return to the application</a></body></html>');
        if (maskPath) return res.status(404).json({ code: "component_disabled", componentId: "system.mask_mode" });
        if (identity && !(current as any)?.passport?.user) return refuse(401);
        return next();
      }
      if (needsReauthentication(req.session)) return reauthenticate();
      if (!control && !bootstrap && isOffCodeAsset(req) && readMaskState(loadedPolicy).mode === "off") return next();
      const exclusive = (control && req.method === "POST") ||
        req.path.startsWith("/api/auth/masquerade") || req.path === "/api/logout";
      // Authenticated requests are held through FINAL HTTP delivery, not only
      // handler completion. An ON transition cannot pass outstanding OFF work.
      if (identity || loadedPolicy !== undefined) {
        lease = await deps.acquire(req.sessionID, exclusive);
        if (!lease) return refuse(503);
        // IncomingMessage.destroyed is also true after a successfully consumed
        // POST body. It is not a client-disconnect signal.
        if (res.destroyed || req.aborted) { await lease.release(); return; }
        const heldLease = lease;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          void heldLease.release();
        };
        res.once("finish", release);
        res.once("close", release);
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        const originalWriteHead = res.writeHead.bind(res);
        const alive = () => {
          if (!heldLease.isHeld || heldLease.isHeld()) return true;
          res.destroy();
          return false;
        };
        // This covers JSON, send, redirects, errors, files and streamed chunks.
        // Losing the DB connection/lease must not allow an old response through.
        res.write = ((...args: any[]) => alive() ? (originalWrite as any)(...args) : false) as any;
        res.end = ((...args: any[]) => alive() ? (originalEnd as any)(...args) : res) as any;
        res.writeHead = ((...args: any[]) => alive() ? (originalWriteHead as any)(...args) : res) as any;
      }
      const payload = identity || loadedPolicy !== undefined
        ? await deps.read(req.sessionID) : undefined;
      component = await deps.component();
      if (needsReauthentication(payload)) return reauthenticate();
      if (!component.enabled) {
        if (bootstrap) return res.json({ maskModeEnabled: false });
        if (maskPath) return res.status(404).json({ code: "component_disabled", componentId: "system.mask_mode" });
        return next();
      }
      if (lease && !lease.isHeld?.()) { res.destroy(); return; }
      const state = readMaskState((payload as any)?.maskMode);
      const authenticated = identity && Boolean((payload as any)?.passport?.user);
      if (identity && !authenticated) return refuse(401);
      res.setHeader("X-Mask-Revision", String(state.revision));
      res.setHeader("X-Mask-Mode", authenticated ? state.mode : "anonymous");
      if (bootstrap) return res.json({ maskModeEnabled: true });

      // A standalone, code-owned document. It never embeds raw state, a
      // requested URL, configured branding, stored help or a provider identity.
      if (req.path === "/mask-mode" && READ_METHODS.has(req.method)) {
        res.setHeader("Content-Security-Policy",
          "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        return res.type("html").send(maskModePage);
      }
      if (req.path === "/mask-mode/client.js" && READ_METHODS.has(req.method)) {
        return res.type("application/javascript").send(maskModeScript);
      }
      if (req.path === STATE && req.method === "GET") {
        const rights = authenticated
          ? await deps.permissions(req, payload) : { canToggle: false, canRead: false };
        const reauthRequired = authenticated && (payload as any)?.maskModeEpoch !== component.epoch;
        return res.json({ ...state, mode: authenticated ? state.mode : "anonymous",
          ...rights, canManage: rights.canToggle, canToggle: rights.canToggle && !reauthRequired, reauthRequired });
      }
      if (control) {
        // No form submissions, cross-origin writes or unacknowledged toggles.
        if (!authenticated && req.path !== LOGOUT) return refuse(401);
        if (req.method === "POST") {
          const origin = req.get("origin");
          if (!origin || new URL(origin).host !== req.get("host") ||
              !req.is("application/json")) return refuse(403);
        }
        // Revoked/deleted users can still end their own browser session.
        // Logout must not depend on a permissions lookup succeeding.
        if (req.path === LOGOUT && req.method === "POST") {
          await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
          res.clearCookie("connect.sid", { path: "/" });
          return res.json({ signedOut: true });
        }
        const rights = await deps.permissions(req, payload);
        if (req.path === STATE && req.method === "POST") {
          const body = req.body;
          if (!rights.canToggle) return refuse(403);
          if (!body || !["on", "off"].includes(body.mode) ||
              body.acknowledged !== true || !Number.isSafeInteger(body.revision) ||
              body.revision < 0 || Object.keys(body).some(k => !["mode", "revision", "acknowledged"].includes(k))) {
            return refuse(400);
          }
          const after = await deps.transition(req.sessionID, body.revision, body.mode);
          if (!after) return refuse(409);
          res.setHeader("X-Mask-Revision", String(after.revision));
          res.setHeader("X-Mask-Mode", after.mode);
          return res.json(after);
        }
        if (req.path === PEOPLE && req.method === "GET") {
          if (state.mode !== "on" || !rights.canRead ||
              req.get("X-Mask-Revision") !== String(state.revision)) return refuse(409);
          const rows = await deps.people();
          // Explicit projection is after the data read, with no shared cache.
          const currentYear = new Date().getUTCFullYear();
          return res.json({
            revision: state.revision,
            people: rows.slice(0, 20).map(row => projectTrainingPerson(row, randomUUID(), currentYear)),
          });
        }
        return refuse(405);
      }

      if (state.mode !== "off") {
        // No normal handler is admitted: side effects and every unclassified
        // non-JSON transport are refused BEFORE any domain work.
        if (READ_METHODS.has(req.method) && !req.path.startsWith("/api/")) {
          return res.redirect(303, "/mask-mode");
        }
        return refuse();
      }
      const revision = req.get("X-Mask-Revision");
      if (revision !== undefined && revision !== String(state.revision)) return refuse(409);
      return next();
    } catch {
      // No storage/authz/parser exception, query or raw response is relayed.
      if (res.headersSent) res.destroy();
      else refuse(503);
    }
  };
}
