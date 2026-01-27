import type { Express } from "express";
import { storage } from "../storage";

export function registerSiteSettingsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any
) {
  // GET /api/site-settings - Get site settings (no auth required for public settings)
  app.get("/api/site-settings", async (req, res) => {
    try {
      const siteNameVar = await storage.variables.getByName("site_name");
      const siteName = siteNameVar ? (siteNameVar.value as string) : "Sirius";
      
      const siteTitleVar = await storage.variables.getByName("site_title");
      const siteTitle = siteTitleVar ? (siteTitleVar.value as string) : "";
      
      const siteFooterVar = await storage.variables.getByName("site_footer");
      const footer = siteFooterVar ? (siteFooterVar.value as string) : "";
      
      res.json({ siteName, siteTitle, footer });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch site settings" });
    }
  });

  // PUT /api/site-settings - Update site settings (requires admin permissions)
  app.put("/api/site-settings", requireAccess('admin'), async (req, res) => {
    try {
      const { siteName, siteTitle, footer } = req.body;
      
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
      
      // Update siteTitle if provided
      if (siteTitle !== undefined) {
        if (typeof siteTitle !== "string") {
          res.status(400).json({ message: "Invalid site title" });
          return;
        }
        if (siteTitle.length > 50) {
          res.status(400).json({ message: "Site title must be 50 characters or less" });
          return;
        }
        
        const existingTitle = await storage.variables.getByName("site_title");
        if (existingTitle) {
          await storage.variables.update(existingTitle.id, { value: siteTitle });
        } else {
          await storage.variables.create({ name: "site_title", value: siteTitle });
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
      
      const siteTitleVar = await storage.variables.getByName("site_title");
      const finalSiteTitle = siteTitleVar ? (siteTitleVar.value as string) : "";
      
      const siteFooterVar = await storage.variables.getByName("site_footer");
      const finalFooter = siteFooterVar ? (siteFooterVar.value as string) : "";
      
      res.json({ siteName: finalSiteName, siteTitle: finalSiteTitle, footer: finalFooter });
    } catch (error) {
      res.status(500).json({ message: "Failed to update site settings" });
    }
  });
}
