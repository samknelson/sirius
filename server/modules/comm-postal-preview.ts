import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  POSTAL_PDF_PREVIEW_FLOOD_EVENT,
} from "../flood/events";
import { checkFlood, recordFloodEvent } from "../flood/service";
import { logger } from "../logger";
import { getEffectiveUser } from "./masquerade";

type Middleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<unknown>;

type RequireAccess = (policy: string) => Middleware;

const MAX_BODY_BYTES = 200_000;
const previewRequest = z.object({
  body: z.string(),
}).strict();

export function registerCommPostalPreviewRoutes(
  app: Express,
  requireAuth: Middleware,
  requireAccess: RequireAccess,
): void {
  app.post(
    "/api/comm/postal/preview",
    requireAuth,
    requireAccess("staff"),
    async (req, res) => {
      const parsed = previewRequest.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Request must contain only a letter body string",
        });
      }

      if (Buffer.byteLength(parsed.data.body, "utf8") > MAX_BODY_BYTES) {
        return res.status(413).json({
          message: "Letter body is too large (maximum 200,000 UTF-8 bytes)",
        });
      }

      let effectiveUser: Awaited<ReturnType<typeof getEffectiveUser>>;
      try {
        effectiveUser = await getEffectiveUser(
          req.session as any,
          req.user as any,
        );
      } catch {
        logger.error("Failed to resolve postal PDF preview user", {
          service: "comm-postal-preview",
        });
        return res.status(500).json({
          message: "Unable to authorize the PDF preview",
        });
      }
      const { dbUser } = effectiveUser;
      if (!dbUser) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Rendering is expensive, but a flood-store outage must not take the
      // preview UI down. Follow the shared framework's check-then-record
      // convention and fail open when either operation fails.
      const floodContext = { userId: dbUser.id };
      try {
        const flood = await checkFlood(
          POSTAL_PDF_PREVIEW_FLOOD_EVENT,
          floodContext,
        );
        if (!flood.allowed) {
          return res.status(429).json({
            message: "Too many PDF previews. Wait a moment and try again.",
          });
        }
        await recordFloodEvent(
          POSTAL_PDF_PREVIEW_FLOOD_EVENT,
          floodContext,
        );
      } catch (floodError) {
        logger.warn(
          "Postal PDF preview flood check failed; allowing the preview",
          {
            service: "comm-postal-preview",
            error:
              floodError instanceof Error
                ? floodError.message
                : String(floodError),
          },
        );
      }

      try {
        // Keep the PDF runtime off the server startup path. This is the same
        // renderer used by sending; previewGuides only adds non-mailing guides
        // after the identical letter has been rendered.
        const { renderLetterPdf } = await import("../services/comm/letter-pdf");
        const pdf = await renderLetterPdf(parsed.data.body, {
          previewGuides: true,
        });

        res.set({
          "Cache-Control": "no-store",
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="letter-preview.pdf"',
          "Content-Length": String(pdf.byteLength),
          "X-Content-Type-Options": "nosniff",
        });
        return res.send(pdf);
      } catch (error) {
        // Do not log the renderer error object: validation failures can carry
        // details derived from private letter content.
        logger.error("Failed to render postal PDF preview", {
          service: "comm-postal-preview",
          errorType: error instanceof Error ? error.name : typeof error,
        });
        return res.status(500).json({
          message: "Unable to generate the PDF preview",
        });
      }
    },
  );
}