import { storage } from "../../../storage";
import { wizardRegistry } from "../../../wizards";
import type { JsonSchema } from "@shared/json-schema-form";
import type { DashboardPlugin } from "../types";

async function buildSchema(): Promise<JsonSchema> {
  const roles = await storage.users.getAllRoles();
  const monthlyTypes = wizardRegistry.getAll().filter((t) => t.isMonthly);
  const enumValues = monthlyTypes.map((t) => t.name);
  const enumNames = monthlyTypes.map((t) => t.displayName || t.name);
  const properties: Record<string, JsonSchema> = {};
  for (const role of roles) {
    properties[role.id] = {
      type: "array",
      title: role.name,
      description: role.description || undefined,
      uniqueItems: true,
      items: {
        type: "string",
        enum: enumValues,
        enumNames,
      } as JsonSchema,
    };
  }
  return {
    type: "object",
    title: "Employer Monthly Uploads",
    description:
      "Select which monthly wizard types appear on the dashboard for each role.",
    properties,
  };
}

async function buildUiSchema() {
  const roles = await storage.users.getAllRoles();
  const ui: Record<string, any> = {};
  for (const role of roles) {
    ui[role.id] = { "ui:widget": "checkboxes" };
  }
  return ui;
}

function collectAllowedWizardTypes(
  config: Record<string, string[]>,
  roleIds: string[],
): Set<string> {
  const allowed = new Set<string>();
  for (const roleId of roleIds) {
    const types = config[roleId] || [];
    for (const t of types) allowed.add(t);
  }
  return allowed;
}

export const employerMonthlyUploadsPlugin: DashboardPlugin = {
  id: "employer-monthly-uploads",
  name: "Employer Monthly Uploads",
  description: "Display employer monthly upload statistics by wizard type",
  settingsSchema: buildSchema,
  uiSchema: buildUiSchema,
  defaultSettings: {},

  requiredPolicy: "admin",

  async migrateLegacySettings() {
    const legacy = await storage.variables.getByName("employer_monthly_plugin_config");
    if (!legacy) return null;
    return legacy.value as Record<string, string[]>;
  },

  content: {
    // Default action — what the widget itself needs to render. Returns the
    // monthly wizard types this user can see (driven by role-based plugin
    // settings), so the widget never has to call /api/wizard-types directly.
    "": async (ctx) => {
      const config = (ctx.settings ?? {}) as Record<string, string[]>;
      const allowed = collectAllowedWizardTypes(
        config,
        ctx.userRoles.map((r) => r.id),
      );
      const wizardTypes = wizardRegistry
        .getAll()
        .filter((t) => t.isMonthly && allowed.has(t.name))
        .map((t) => ({
          name: t.name,
          displayName: t.displayName || t.name,
          isMonthly: true,
        }));
      return { wizardTypes };
    },

    stats: async (ctx) => {
      const { year, month, wizardType } = ctx.query as Record<string, string | undefined>;
      const now = new Date();
      const yearNum = year ? Number(year) : now.getFullYear();
      const monthNum = month ? Number(month) : now.getMonth() + 1;

      if (!wizardType || typeof wizardType !== "string") {
        throw Object.assign(new Error("Wizard type is required"), { status: 400 });
      }
      if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
        throw Object.assign(new Error("Year must be a valid integer between 1900 and 2100"), {
          status: 400,
        });
      }
      if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
        throw Object.assign(new Error("Month must be a valid integer between 1 and 12"), {
          status: 400,
        });
      }

      const config = (ctx.settings ?? {}) as Record<string, string[]>;
      const allowed = collectAllowedWizardTypes(
        config,
        ctx.userRoles.map((r) => r.id),
      );
      if (!allowed.has(wizardType)) {
        throw Object.assign(
          new Error(
            "Access denied: You do not have permission to view statistics for this wizard type",
          ),
          { status: 403 },
        );
      }

      return await ctx.storage.wizardEmployerMonthly.getMonthlyStats(
        yearNum,
        monthNum,
        wizardType,
      );
    },
  },

  client: {
    component: "employer-monthly-uploads:EmployerMonthlyUploads",
    order: 4,
    requiredPermissions: ["admin"],
  },
};
