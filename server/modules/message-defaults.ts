import type { Express } from "express";
import { z } from "zod";
import { requireAccess } from "../services/access-policy-evaluator";
import { storage } from "../storage";
import {
  getEmailDefaults, getPostalDefaults, messageDefaultsKey, prepareEmailContent,
  validateEmailDefaults, validatePostalDefaults,
} from "../services/comm/message-defaults";
import { sendIfMaintenanceRefusal } from "../services/maintenance-flag";

/** Only admin settings routes accept overrides. Send-facing previews cannot. */
export function registerMessageDefaultsRoutes(app: Express, medium: "email" | "postal"): void {
  const path = `/api/config/${medium}/message-defaults`;
  app.get(path, requireAccess("admin"), async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store").json(
        medium === "email" ? await getEmailDefaults() : await getPostalDefaults(),
      );
    } catch (error) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({ message: "Unable to load message defaults." });
    }
  });
  for (const preview of [false, true]) {
    app[preview ? "post" : "put"](preview ? `${path}/preview` : path, requireAccess("admin"), async (req, res) => {
      try {
        const defaults = medium === "email" ? validateEmailDefaults(req.body) : validatePostalDefaults(req.body);
        if (!preview) {
          await storage.variables.setByName(messageDefaultsKey(medium), defaults);
          return res.json(defaults);
        }
        res.set("Cache-Control", "no-store");
        if (medium === "email") {
          return res.json(prepareEmailContent({ bodyHtml: "<p>This is an example message body.</p>" }, defaults));
        }
        const { renderLetterPdf } = await import("../services/comm/letter-pdf");
        const pdf = await renderLetterPdf("<p>This is an example letter body.</p><p style=\"break-before:page\">This is a continuation page.</p>", {
          defaults: validatePostalDefaults(defaults), previewGuides: true,
        });
        return res.type("application/pdf").send(pdf);
      } catch (error) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        res.status(error instanceof z.ZodError ? 400 : 422).json({
          message: error instanceof Error ? error.message : "Unable to prepare message defaults.",
        });
      }
    });
  }
}
