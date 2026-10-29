import type { Express, NextFunction, Request, Response } from "express";
import {
  resolveRecordGoIdentifier,
  recordGoAccessRequirement,
  type RecordGoResolution,
} from "../services/record-go";
import { escapeHtml } from "@shared/utils/html";

type AuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<any>;
type AuthorizeRecord = (req: Request, resolution: Extract<RecordGoResolution, { kind: "resolved" }>) => Promise<boolean>;

function sendGoError(res: Response, status: number, title: string, detail: string): void {
  res.status(status).type("html").send(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
      <p><a href="/go">Try another record identifier</a></p>
    </main>
  </body>
</html>`);
}

export function registerRecordGoRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  authorizeRecord?: AuthorizeRecord,
): void {
  // /go may be served by a separate static process. The SPA resolves through
  // /api so split deployments reach the user API, not the static fallback.
  app.get(["/go/:id", "/api/go/:id"], requireAuth, async (req, res, next) => {
    const isApi = req.path.startsWith("/api/");
    res.set("Cache-Control", "private, no-store");
    res.vary("Cookie");
    const sendError = (title: string, message: string) => {
      if (isApi) return res.status(404).json({ title, message });
      return sendGoError(res, 404, title, message);
    };

    try {
      const resolution = await resolveRecordGoIdentifier(req.params.id);
      if (
        resolution.kind === "resolved" &&
        authorizeRecord &&
        recordGoAccessRequirement(resolution.metadata.contextId) &&
        await authorizeRecord(req, resolution)
      ) {
        if (isApi) return res.json({ href: resolution.href });
        return res.redirect(302, resolution.href);
      }
      if (resolution.kind === "not_found" && resolution.reason === "no_page") {
        return sendError(
          "This record has no page",
          "The identifier matched a record, but that record type is only available through another screen.",
        );
      }
      return sendError(
        "Record not found",
        "That identifier is not a known record id, metadata id, or record sequence.",
      );
    } catch (error) {
      next(error);
    }
  });
}