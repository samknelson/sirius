import type { Request, RequestHandler } from "express";
import { readMaskState, type MaskPolicy } from "@shared/privacy/mask-mode";

export interface MaskModeDependencies {
  component(): Promise<{ enabled: boolean; epoch: string | null }>;
  read(sid: string): Promise<unknown>;
  transition(sid: string, expected: number, mode: "on" | "off"): Promise<MaskPolicy | null>;
  permissions(req: Request, session: unknown): Promise<{ canToggle: boolean; canRead: boolean }>;
}

export const PRESENTATION_BOOTSTRAP = "/api/components/presentation";

/** Display preference controls only. Ordinary requests never consult this feature. */
export function createMaskModeMiddleware(deps: MaskModeDependencies): RequestHandler {
  return async (req, res, next) => {
    if (req.path === "/mask-mode" || req.path === "/mask-mode/client.js") {
      return res.redirect(303, "/");
    }
    if (req.path !== PRESENTATION_BOOTSTRAP && !req.path.startsWith("/api/mask-mode/")) return next();
    res.setHeader("Cache-Control", "no-store, private");
    const error = (status: number, message: string) => res.status(status).json({ message });
    try {
      const component = await deps.component();
      if (req.path === PRESENTATION_BOOTSTRAP) return res.json({ maskModeEnabled: component.enabled });
      if (req.path !== "/api/mask-mode/state") return error(410, "The training view has been retired. Return to the application.");
      if (!component.enabled && req.method === "GET") {
        return res.json({ version: 1, revision: 0, mode: "off", enabled: false, canToggle: false });
      }
      const session = await deps.read(req.sessionID) as any;
      const authenticated = Boolean(req.user && session?.passport?.user);
      const state = readMaskState(session?.maskMode);
      // Legacy unknown/revoked sessions upgrade in place: no forced logout.
      const mode = component.enabled && state.mode === "on" ? "on" : "off";
      if (req.method === "GET") {
        const rights = authenticated ? await deps.permissions(req, session) : { canToggle: false };
        return res.json({ version: 1, revision: state.revision, mode, enabled: component.enabled,
          canToggle: component.enabled && rights.canToggle, authenticated });
      }
      if (req.method !== "POST") return error(405, "Method not allowed");
      if (!authenticated) return error(401, "Sign in to change Mask Mode.");
      if (!component.enabled) return error(409, "Mask Mode is disabled.");
      const origin = req.get("origin");
      if (!origin || new URL(origin).host !== req.get("host") || !req.is("application/json")) return error(403, "Invalid request origin or content type.");
      if (!(await deps.permissions(req, session)).canToggle) return error(403, "Current administrator access is required.");
      const body = req.body;
      if (!body || !["on", "off"].includes(body.mode) || !Number.isSafeInteger(body.revision) ||
          body.revision < 0 || Object.keys(body).some(k => !["mode", "revision", "acknowledged"].includes(k))) return error(400, "Invalid Mask Mode preference.");
      const after = await deps.transition(req.sessionID, body.revision, body.mode);
      if (!after) return error(409, "Mask Mode changed in another tab. Retry.");
      return res.json(after);
    } catch {
      return error(503, "Mask Mode state could not be checked. Screen masking is not confirmed; retry before recording.");
    }
  };
}
