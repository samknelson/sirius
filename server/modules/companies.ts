import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertCompanySchema } from "@shared/schema/employer/company-schema";
import { requireComponent } from "./components";
import { requireAccess } from "../services/access-policy-evaluator";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerCompaniesRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
) {
  app.get(
    "/api/companies",
    requireAuth,
    requireComponent("employer.company"),
    requireAccess("staff"),
    async (req, res) => {
      try {
        const companies = await storage.companies.getAll();
        res.json(companies);
      } catch (error) {
        console.error("Error fetching companies:", error);
        res.status(500).json({ message: "Failed to fetch companies" });
      }
    }
  );

  app.get(
    "/api/companies/:id",
    requireAuth,
    requireComponent("employer.company"),
    requireAccess("staff"),
    async (req, res) => {
      try {
        const company = await storage.companies.get(req.params.id);
        if (!company) {
          return res.status(404).json({ message: "Company not found" });
        }
        res.json(company);
      } catch (error) {
        console.error("Error fetching company:", error);
        res.status(500).json({ message: "Failed to fetch company" });
      }
    }
  );

  app.get(
    "/api/companies/:id/employers",
    requireAuth,
    requireComponent("employer.company"),
    requireAccess("staff"),
    async (req, res) => {
      try {
        const company = await storage.companies.get(req.params.id);
        if (!company) {
          return res.status(404).json({ message: "Company not found" });
        }
        const employers = await storage.employerCompanies.getEmployersByCompanyId(req.params.id);
        res.json(employers);
      } catch (error) {
        console.error("Error fetching employers for company:", error);
        res.status(500).json({ message: "Failed to fetch employers for company" });
      }
    }
  );

  app.post(
    "/api/companies",
    requireAuth,
    requireComponent("employer.company"),
    requireAccess("staff"),
    async (req, res) => {
      try {
        const parsed = insertCompanySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid company data", errors: parsed.error.errors });
        }
        const company = await storage.companies.create(parsed.data);
        res.status(201).json(company);
      } catch (error) {
        console.error("Error creating company:", error);
        res.status(500).json({ message: "Failed to create company" });
      }
    }
  );

  app.put(
    "/api/companies/:id",
    requireAuth,
    requireComponent("employer.company"),
    requireAccess("staff"),
    async (req, res) => {
      try {
        const parsed = insertCompanySchema.partial().safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid company data", errors: parsed.error.errors });
        }
        const company = await storage.companies.update(req.params.id, parsed.data);
        if (!company) {
          return res.status(404).json({ message: "Company not found" });
        }
        res.json(company);
      } catch (error) {
        console.error("Error updating company:", error);
        res.status(500).json({ message: "Failed to update company" });
      }
    }
  );

  app.delete(
    "/api/companies/:id",
    requireAuth,
    requireComponent("employer.company"),
    requireAccess("staff"),
    async (req, res) => {
      try {
        const deleted = await storage.companies.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ message: "Company not found" });
        }
        res.json({ message: "Company deleted" });
      } catch (error) {
        console.error("Error deleting company:", error);
        res.status(500).json({ message: "Failed to delete company" });
      }
    }
  );
}
