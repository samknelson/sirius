import { registerDashboardPlugin } from "../registry";
import { storage } from "../../../storage";
import { wizardPluginRegistry } from "../../wizards";
import type { JsonSchema } from "@shared/json-schema-form";
import type { DashboardPlugin } from "../types";

interface ReportTypeInfo {
  /** The wizard type identifier used as the report key. */
  name: string;
  displayName: string;
}

/**
 * Report wizards are plugins on `wizardPluginRegistry`. The dashboard lists
 * every report-style wizard so it stays configurable and visible.
 */
function listReportTypes(): ReportTypeInfo[] {
  const byId = new Map<string, ReportTypeInfo>();
  for (const p of wizardPluginRegistry.list()) {
    if (!(p.isReport ?? false)) continue;
    if (byId.has(p.id)) continue;
    byId.set(p.id, { name: p.id, displayName: p.name });
  }
  return Array.from(byId.values());
}

async function buildSchema(): Promise<JsonSchema> {
  const roles = await storage.users.getAllRoles();
  const reportTypes = listReportTypes();
  const enumValues = reportTypes.map((t) => t.name);
  const enumNames = reportTypes.map((t) => t.displayName);
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
    title: "Dashboard Reports",
    description: "Configure which reports appear on the dashboard for each role.",
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

export const reportsPlugin: DashboardPlugin = {
  id: "reports",
  name: "Reports",
  description: "Display recent report summaries with links to details",
  settingsSchema: buildSchema,
  uiSchema: buildUiSchema,
  defaultSettings: {},
  requiredPolicy: "admin",

  async content(ctx) {
    const config = (ctx.settings ?? {}) as Record<string, string[]>;

    const userReportTypeNames = new Set<string>();
    for (const role of ctx.userRoles) {
      for (const name of config[role.id] ?? []) userReportTypeNames.add(name);
    }
    if (userReportTypeNames.size === 0) return { reports: [] };

    const allReportTypes = new Map(
      listReportTypes().map((t) => [t.name, t]),
    );

    interface ReportMeta {
      generatedAt?: string;
      recordCount?: number;
    }
    const readReportMeta = (data: unknown): ReportMeta | null => {
      if (!data || typeof data !== "object") return null;
      const maybeMeta = (data as { reportMeta?: unknown }).reportMeta;
      if (!maybeMeta || typeof maybeMeta !== "object") return null;
      const m = maybeMeta as Record<string, unknown>;
      return {
        generatedAt: typeof m.generatedAt === "string" ? m.generatedAt : undefined,
        recordCount: typeof m.recordCount === "number" ? m.recordCount : undefined,
      };
    };

    const reports: Array<{
      type: string;
      displayName: string;
      wizardId: string;
      generatedAt: string | null;
      recordCount: number;
    }> = [];

    for (const typeName of Array.from(userReportTypeNames)) {
      const reportType = allReportTypes.get(typeName);
      if (!reportType) continue;
      const wizards = await ctx.storage.wizards.list({ type: typeName });
      if (wizards.length === 0) continue;
      const sorted = [...wizards].sort((a, b) => {
        const aDate = readReportMeta(a.data)?.generatedAt ?? "";
        const bDate = readReportMeta(b.data)?.generatedAt ?? "";
        return bDate.localeCompare(aDate);
      });
      const w = sorted[0];
      const meta = readReportMeta(w.data);
      reports.push({
        type: typeName,
        displayName: reportType.displayName || typeName,
        wizardId: w.id,
        generatedAt: meta?.generatedAt ?? null,
        recordCount: meta?.recordCount ?? 0,
      });
    }

    return { reports };
  },

  client: {
    component: "reports:Reports",
    order: 3,
    requiredPermissions: ["admin"],
  },
};

registerDashboardPlugin(reportsPlugin);
