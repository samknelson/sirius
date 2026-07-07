import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import { insertVariableSchema } from "@shared/schema";
import { requireAccess } from "../../services/access-policy-evaluator";
import {
  checkVariableReadAccess,
  checkVariableWriteAccess,
  validateVariableValue,
  runVariableOnWrite,
} from "./variable-registry";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerVariableRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  app.get("/api/variables", requireAccess('admin'), async (req, res) => {
    try {
      const variables = await storage.variables.getAll();
      res.json(variables);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch variables" });
    }
  });

  // Per-variable read access: no blanket auth middleware. The registry in
  // variable-registry.ts decides who may read each variable; unlisted
  // names require the admin policy exactly as before.
  app.get("/api/variables/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const variable = await storage.variables.get(id);

      if (!variable) {
        // Don't reveal existence/non-existence to non-admins: run the
        // default (admin) check before returning 404.
        const decision = await checkVariableReadAccess(req, "");
        if (!decision.granted) {
          res.status(decision.status).json({ message: decision.message });
          return;
        }
        res.status(404).json({ message: "Variable not found" });
        return;
      }

      // Same-record authz: check against the resolved row's name.
      const decision = await checkVariableReadAccess(req, variable.name);
      if (!decision.granted) {
        res.status(decision.status).json({ message: decision.message });
        return;
      }

      res.json(variable);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch variable" });
    }
  });

  app.get("/api/variables/by-name/:name", async (req, res) => {
    try {
      const { name } = req.params;

      // Check access BEFORE fetching so 401/403 comes before any 404,
      // never revealing whether a restricted variable exists.
      const decision = await checkVariableReadAccess(req, name);
      if (!decision.granted) {
        res.status(decision.status).json({ message: decision.message });
        return;
      }

      const variable = await storage.variables.getByName(name);

      if (!variable) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }

      res.json(variable);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch variable" });
    }
  });

  // Upsert a variable by name. Access + value validation come from the
  // variable registry: writeTier (default admin), optional component gate,
  // optional zod schema for the value, optional onWrite hook.
  app.put("/api/variables/by-name/:name", async (req, res) => {
    try {
      const { name } = req.params;

      const decision = await checkVariableWriteAccess(req, name);
      if (!decision.granted) {
        res.status(decision.status).json({ message: decision.message });
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(req.body ?? {}, "value")) {
        res.status(400).json({ message: "Request body must include a value" });
        return;
      }

      const validation = validateVariableValue(name, req.body.value);
      if (!validation.ok) {
        res.status(400).json({ message: "Invalid variable value", errors: validation.errors });
        return;
      }

      const existing = await storage.variables.getByName(name);
      const variable = existing
        ? await storage.variables.update(existing.id, { value: validation.value })
        : await storage.variables.create({ name, value: validation.value });

      await runVariableOnWrite(name);
      res.json(variable);
    } catch (error) {
      res.status(500).json({ message: "Failed to save variable" });
    }
  });

  // Delete a variable by name (used e.g. for terminology reset). Same
  // registry-driven write access; deleting a missing variable is a 404
  // only after access is granted, so existence is never leaked.
  app.delete("/api/variables/by-name/:name", async (req, res) => {
    try {
      const { name } = req.params;

      const decision = await checkVariableWriteAccess(req, name);
      if (!decision.granted) {
        res.status(decision.status).json({ message: decision.message });
        return;
      }

      const existing = await storage.variables.getByName(name);
      if (!existing) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }

      await storage.variables.delete(existing.id);
      await runVariableOnWrite(name);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete variable" });
    }
  });

  app.post("/api/variables", requireAccess('admin'), async (req, res) => {
    try {
      const validatedData = insertVariableSchema.parse(req.body);
      
      const existingVariable = await storage.variables.getByName(validatedData.name);
      if (existingVariable) {
        res.status(409).json({ message: "Variable name already exists" });
        return;
      }

      // Enforce the registry writeTier (incl. component gates) on top of
      // the blanket admin requirement, so the generic route can never be
      // a softer path than the by-name route.
      const writeDecision = await checkVariableWriteAccess(req, validatedData.name);
      if (!writeDecision.granted) {
        res.status(writeDecision.status).json({ message: writeDecision.message });
        return;
      }

      // Registered variables get their value validated even on the
      // generic admin route, so the Options page can't write garbage.
      const validation = validateVariableValue(validatedData.name, validatedData.value);
      if (!validation.ok) {
        res.status(400).json({ message: "Invalid variable value", errors: validation.errors });
        return;
      }

      const variable = await storage.variables.create({ ...validatedData, value: validation.value });
      await runVariableOnWrite(validatedData.name);
      res.status(201).json(variable);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid variable data" });
      } else if (error instanceof Error && 'code' in error && (error as any).code === '23505') {
        res.status(409).json({ message: "Variable name already exists" });
      } else {
        res.status(500).json({ message: "Failed to create variable" });
      }
    }
  });

  app.put("/api/variables/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertVariableSchema.partial().parse(req.body);
      
      if (validatedData.name) {
        const existingVariable = await storage.variables.getByName(validatedData.name);
        if (existingVariable && existingVariable.id !== id) {
          res.status(409).json({ message: "Variable name already exists" });
          return;
        }
      }

      const current = await storage.variables.get(id);
      if (!current) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }

      // Validate the FINAL persisted value against the registry schema for
      // the variable's effective (possibly renamed) name — including
      // rename-only updates, where the existing stored value must satisfy
      // the target name's schema.
      const effectiveName = validatedData.name ?? current.name;

      // Enforce the registry writeTier for BOTH the current and the
      // effective (possibly renamed) name, on top of the blanket admin
      // requirement, so renames can't dodge a stricter gate.
      for (const gateName of Array.from(new Set([current.name, effectiveName]))) {
        const writeDecision = await checkVariableWriteAccess(req, gateName);
        if (!writeDecision.granted) {
          res.status(writeDecision.status).json({ message: writeDecision.message });
          return;
        }
      }

      const finalValue = validatedData.value !== undefined ? validatedData.value : current.value;
      const validation = validateVariableValue(effectiveName, finalValue);
      if (!validation.ok) {
        res.status(400).json({ message: "Invalid variable value", errors: validation.errors });
        return;
      }
      validatedData.value = validation.value;

      const variable = await storage.variables.update(id, validatedData);
      
      if (!variable) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }

      await runVariableOnWrite(effectiveName);
      res.json(variable);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid variable data" });
      } else if (error instanceof Error && 'code' in error && (error as any).code === '23505') {
        res.status(409).json({ message: "Variable name already exists" });
      } else {
        res.status(500).json({ message: "Failed to update variable" });
      }
    }
  });

  app.delete("/api/variables/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const current = await storage.variables.get(id);
      const deleted = await storage.variables.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Variable not found" });
        return;
      }

      // Keep by-id deletion consistent with by-name deletion: run any
      // registry onWrite hook (e.g. terminology cache invalidation).
      if (current) {
        await runVariableOnWrite(current.name);
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete variable" });
    }
  });
}
