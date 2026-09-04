import type { Express } from "express";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import {
  ENV_RELEASE_SENTINEL,
  getConfiguredEnvironmentValue,
  isEnvironmentVariableOverridable,
  isEnvironmentVariableRegistered,
  isEnvironmentVariableSetInProcess,
  listEnvironmentVariables,
} from "../../config/env-registry";
import { shortEnvironmentValueFingerprint } from "../../config/env-value-fingerprint";
import {
  envOverrideVariableName,
  getEnvOverrideMap,
} from "../../services/env-overrides";
import { validateVariableValue, runVariableOnWrite } from "./variable-registry";

/**
 * Admin endpoints for the /config/env page (Task #1080).
 *
 * - GET  /api/admin/env            — all registered variables with status,
 *   source (environment | override | unset), and values (secret values are
 *   NEVER returned, regardless of source).
 * - PUT  /api/admin/env/:name      — set a DB override for a variable that
 *   is not set in the real environment.
 * - DELETE /api/admin/env/:name    — clear a DB override.
 *
 * Writes go through the same storage + registry path as the generic
 * variable routes (schema validation, audit logging, onWrite cache refresh).
 */
export function registerEnvRoutes(app: Express) {
  app.get("/api/admin/env", requireAccess("admin"), async (_req, res) => {
    try {
      const overrides = getEnvOverrideMap();
      const vars = listEnvironmentVariables().map((v) => {
        let value: string | null = null;
        if (!v.secret && v.isSet) {
          try {
            // What the variable is CONFIGURED to be: for a value the app
            // planted in its own environment from a stored one, the running
            // process keeps using the planted value until a restart, so
            // reading that back would show an edit made on this very page as
            // having done nothing.
            value = getConfiguredEnvironmentValue(v.name) ?? null;
          } catch {
            value = null;
          }
        }
        // A secret's value never leaves the server, so an admin comparing two
        // installations gets a digest of it instead — enough to tell "same" from
        // "different", and nothing else. Non-secret values are shown in full, so
        // a fingerprint would only be noise.
        const fingerprint =
          v.secret && v.isSet ? shortEnvironmentValueFingerprint(v.name) : null;
        return {
          ...v,
          // Never the value for secrets; effective value otherwise.
          value,
          ...(fingerprint !== null ? { valueFingerprint: fingerprint } : {}),
          // A stale override shadowed by a real env value — surfaced so the
          // admin understands why editing is locked despite the override.
          hasShadowedOverride: v.source === "environment" && overrides.has(v.name),
        };
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(vars);
    } catch (error) {
      res.status(500).json({ message: "Failed to list environment variables" });
    }
  });

  // Each override lives in its own variables row named ENV_{NAME}, so
  // writes are simple per-row upserts — no shared-map read-modify-write.

  app.put("/api/admin/env/:name", requireAccess("admin"), async (req, res) => {
    try {
      const { name } = req.params;
      if (!isEnvironmentVariableRegistered(name)) {
        res.status(404).json({ message: "Unknown environment variable" });
        return;
      }
      if (!isEnvironmentVariableOverridable(name)) {
        res.status(400).json({ message: "This variable cannot be overridden" });
        return;
      }
      if (isEnvironmentVariableSetInProcess(name)) {
        res.status(409).json({
          message: "This variable is set in the real environment and is locked",
        });
        return;
      }
      const value = (req.body ?? {}).value;
      if (typeof value !== "string" || value === "") {
        res.status(400).json({ message: "Request body must include a non-empty string value" });
        return;
      }
      if (value === ENV_RELEASE_SENTINEL) {
        res.status(400).json({
          message: "This value is reserved as the deployment release sentinel",
        });
        return;
      }
      const rowName = envOverrideVariableName(name);
      const validation = validateVariableValue(rowName, value);
      if (!validation.ok) {
        const messages = validation.errors.map((e) => e.message).join("; ");
        res.status(400).json({ message: messages || "Invalid override value" });
        return;
      }
      const existing = await storage.variables.getByName(rowName);
      if (existing) {
        await storage.variables.update(existing.id, { value: validation.value });
      } else {
        await storage.variables.create({ name: rowName, value: validation.value });
      }
      await runVariableOnWrite(rowName);
      res.json({ ok: true });
    } catch (error: any) {
      res
        .status(error?.status ?? 500)
        .json({ message: error?.message || "Failed to set override" });
    }
  });

  app.delete("/api/admin/env/:name", requireAccess("admin"), async (req, res) => {
    try {
      const { name } = req.params;
      const rowName = envOverrideVariableName(name);
      const existing = await storage.variables.getByName(rowName);
      if (!existing) {
        res.status(404).json({ message: "No override set for this variable" });
        return;
      }
      await storage.variables.delete(existing.id);
      await runVariableOnWrite(rowName);
      res.json({ ok: true });
    } catch (error: any) {
      res
        .status(error?.status ?? 500)
        .json({ message: error?.message || "Failed to clear override" });
    }
  });
}
