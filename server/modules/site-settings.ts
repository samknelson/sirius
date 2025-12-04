import type { Express } from "express";
import { storage } from "../storage";

export function registerSiteSettingsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any,
  policies: any
) {
  // GET /api/site-settings - Get site settings (no auth required for public settings)
  app.get("/api/site-settings", async (req, res) => {
    try {
      const siteNameVar = await storage.variables.getByName("site_name");
      const siteName = siteNameVar ? (siteNameVar.value as string) : "Sirius";
      
      const siteFooterVar = await storage.variables.getByName("site_footer");
      const footer = siteFooterVar ? (siteFooterVar.value as string) : "";
      
      res.json({ siteName, footer });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch site settings" });
    }
  });

  // PUT /api/site-settings - Update site settings (requires admin permissions)
  app.put("/api/site-settings", requireAccess(policies.admin), async (req, res) => {
    try {
      const { siteName, footer } = req.body;
      
      // Update siteName if provided
      if (siteName !== undefined) {
        if (typeof siteName !== "string") {
          res.status(400).json({ message: "Invalid site name" });
          return;
        }
        
        const existingVariable = await storage.variables.getByName("site_name");
        if (existingVariable) {
          await storage.variables.update(existingVariable.id, { value: siteName });
        } else {
          await storage.variables.create({ name: "site_name", value: siteName });
        }
      }
      
      // Update footer if provided
      if (footer !== undefined) {
        if (typeof footer !== "string") {
          res.status(400).json({ message: "Invalid footer content" });
          return;
        }
        
        const existingFooter = await storage.variables.getByName("site_footer");
        if (existingFooter) {
          await storage.variables.update(existingFooter.id, { value: footer });
        } else {
          await storage.variables.create({ name: "site_footer", value: footer });
        }
      }
      
      // Return updated values
      const siteNameVar = await storage.variables.getByName("site_name");
      const finalSiteName = siteNameVar ? (siteNameVar.value as string) : "Sirius";
      
      const siteFooterVar = await storage.variables.getByName("site_footer");
      const finalFooter = siteFooterVar ? (siteFooterVar.value as string) : "";
      
      res.json({ siteName: finalSiteName, footer: finalFooter });
    } catch (error) {
      res.status(500).json({ message: "Failed to update site settings" });
    }
  });
}
