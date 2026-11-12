import type { Express } from "express";
import { requireAccess } from "../services/access-policy-evaluator";
import { z } from "zod";
import { sendIfMaintenanceRefusal } from "../services/maintenance-flag";
import { registerMessageDefaultsRoutes } from "./message-defaults";
import { getEmailDefaults, prepareEmailContent } from "../services/comm/message-defaults";

/** Transport settings belong to WC connections; branding remains medium-wide. */
export function registerEmailConfigRoutes(app: Express) {
  registerMessageDefaultsRoutes(app, "email");
  app.post("/api/comm/email/preview", requireAccess("staff"), async (req, res) => {
    const parsed = z.object({ bodyHtml: z.string().max(200_000) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Provide a message body (maximum 200,000 characters)." });
    try {
      const result = prepareEmailContent(parsed.data, await getEmailDefaults());
      return res.set("Cache-Control", "no-store").json(result);
    } catch (error) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      return res.status(422).json({ message: error instanceof Error ? error.message : "Unable to preview email." });
    }
  });
}
