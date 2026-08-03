import { registerDashboardPlugin } from "../registry";
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
  const reportTypes = listReportTypes();
  const enumValues = reportTypes.map((t) => t.name);
  const enumNames = reportTypes.map((t) => t.displayName);
  return {
    type: "object",
    title: "Dashboard Reports",
    description:
      "Choose which reports appear on this card. Who sees the card is controlled by the configuration's role.",
    properties: {
      reports: {
        type: "array",
        title: "Reports",
        uniqueItems: true,
        items: {
          type: "string",
          enum: enumValues,
          enumNames,
        } as JsonSchema,
      },
    },
  };
}

async function buildUiSchema() {
  // RJSF v6 no longer reads `enumNames` from inside the schema — labels must
  // come from the uiSchema (`ui:enumNames`, index-aligned with the enum).
  // Keep the in-schema `enumNames` too: our read-only SchemaView still uses it.
  const reportTypes = listReportTypes();
  return {
    reports: {
      "ui:widget": "checkboxes",
      items: { "ui:enumNames": reportTypes.map((t) => t.displayName) },
    },
  };
}

/**
 * Resolve the selected report type names from settings.
 *
 * New shape: `{ reports: string[] }`. Legacy shape (pre-envelope-role
 * cleanup): `{ [roleId]: string[] }` — for those, union the lists for the
 * roles the viewer holds (the old behavior). Read-time compat only; rows
 * normalize to the new shape on next save.
 */
function resolveSelectedReports(
  settings: unknown,
  userRoles: Array<{ id: string }>,
): Set<string> {
  const selected = new Set<string>();
  if (!settings || typeof settings !== "object") return selected;
  const config = settings as Record<string, unknown>;
  if (Array.isArray(config.reports)) {
    for (const name of config.reports) {
      if (typeof name === "string") selected.add(name);
    }
    return selected;
  }
  for (const role of userRoles) {
    const names = config[role.id];
    if (!Array.isArray(names)) continue;
    for (const name of names) {
      if (typeof name === "string") selected.add(name);
    }
  }
  return selected;
}

/**
 * One-time boot normalization: rewrite legacy per-role settings
 * (`{ [roleId]: string[] }`) into the flat `{ reports: string[] }` shape.
 *
 * Without this, opening a legacy row in the settings form shows an empty
 * checkbox list (the form only knows `reports`), and an innocent re-save
 * would wipe the selections. The row's envelope role (the dashboard
 * subsidiary) decides which legacy list carries over — that is the only
 * list the widget could effectively show post-envelope. If the role has no
 * legacy entry, fall back to the union of all lists so nothing silently
 * disappears. Idempotent: already-normalized rows are skipped.
 */
export async function migrateReportsSettings(): Promise<void> {
  const { storage } = await import("../../../storage");
  const { logger } = await import("../../../logger");
  try {
    const rows = await storage.pluginConfigs.getByKindAndPlugin(
      "dashboard",
      "reports",
    );
    let migrated = 0;
    for (const row of rows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      if (Array.isArray(data.reports)) continue;
      const legacyKeys = Object.keys(data).filter((k) =>
        Array.isArray(data[k]),
      );
      if (legacyKeys.length === 0) continue;

      const withSub = await storage.pluginConfigs.getWithSubsidiary(row.id);
      const sub = (withSub?.subsidiary ?? null) as { roles?: string[] | null } | null;
      // Merge the legacy lists of every role the config targets, so a
      // multi-role config keeps every report any of its roles could show.
      const configRoles = Array.isArray(sub?.roles) ? sub!.roles! : [];
      const matchedKeys = configRoles.filter((r) => Array.isArray(data[r]));

      let reports: string[];
      if (matchedKeys.length > 0) {
        const merged = new Set<string>();
        for (const key of matchedKeys) {
          for (const v of data[key] as unknown[]) {
            if (typeof v === "string") merged.add(v);
          }
        }
        reports = Array.from(merged);
      } else {
        const union = new Set<string>();
        for (const key of legacyKeys) {
          for (const v of data[key] as unknown[]) {
            if (typeof v === "string") union.add(v);
          }
        }
        reports = Array.from(union);
      }

      await storage.pluginConfigs.update(row.id, { data: { reports } });
      migrated++;
    }
    if (migrated > 0) {
      logger.info(
        `Normalized ${migrated} reports widget config(s) to flat settings shape`,
        { service: "dashboard-plugins" },
      );
    }
  } catch (error) {
    const { logger } = await import("../../../logger");
    logger.error("Failed to normalize reports widget settings", {
      service: "dashboard-plugins",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const reportsPlugin: DashboardPlugin = {
  id: "reports",
  name: "Reports",
  description: "Display recent report summaries with links to details",
  settingsSchema: buildSchema,
  uiSchema: buildUiSchema,
  defaultSettings: {},

  async content(ctx) {
    const userReportTypeNames = resolveSelectedReports(ctx.settings, ctx.userRoles);
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
      wizardId: string | null;
      generatedAt: string | null;
      recordCount: number | null;
    }> = [];

    for (const typeName of Array.from(userReportTypeNames)) {
      const reportType = allReportTypes.get(typeName);
      if (!reportType) continue;
      const wizards = await ctx.storage.wizards.list({ type: typeName });
      if (wizards.length === 0) {
        reports.push({
          type: typeName,
          displayName: reportType.displayName || typeName,
          wizardId: null,
          generatedAt: null,
          recordCount: null,
        });
        continue;
      }
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
  },
};

registerDashboardPlugin(reportsPlugin);
