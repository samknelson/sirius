import { logger } from "../../../logger";
import { registerDashboardPlugin } from "../registry";
import { storage } from "../../../storage";
import { runInTransaction } from "../../../storage/transaction-context";
import type { JsonSchema } from "@shared/json-schema-form";
import type { DashboardPlugin } from "../types";
import type { DashboardPluginUiSchema } from "../types";

const SERVICE = "dashboard-plugin-welcome-messages";
const LEGACY_VARIABLE_PREFIX = "welcome_message_";

interface WelcomeMessageSettings {
  message?: string;
}

/**
 * Static settings shape: a single HTML message body. Role-based visibility is
 * no longer a per-plugin concern — it's the global `role` envelope field on
 * every dashboard config (stored in the `plugin_configs_dashboard` subsidiary),
 * enforced centrally on the render and content paths.
 */
async function buildSchema(): Promise<JsonSchema> {
  return {
    type: "object",
    title: "Welcome Message",
    description:
      "A welcome message shown to users who hold this config's role. HTML is sanitized for security.",
    properties: {
      message: {
        type: "string",
        title: "Message",
        description: "The welcome message body. Supports basic HTML formatting.",
      },
    },
  };
}

function buildUiSchema(): DashboardPluginUiSchema {
  return {
    message: { "ui:widget": "htmlEditor" },
  };
}

export const welcomeMessagesPlugin: DashboardPlugin = {
  id: "welcome-messages",
  name: "Welcome Messages",
  description: "Display a welcome message to users who hold this config's role",
  settingsSchema: buildSchema,
  uiSchema: buildUiSchema,
  defaultSettings: { message: "" },

  async content(ctx) {
    // Role visibility is enforced centrally (runContent rejects a viewer whose
    // roles don't include this config's role), so the resolver just returns the
    // message body.
    const settings = (ctx.settings ?? {}) as WelcomeMessageSettings;
    const message =
      typeof settings.message === "string" ? settings.message : "";
    return { message: message.trim() ? message : null };
  },

  client: {
    component: "welcome-messages:WelcomeMessages",
    order: 1,
  },
};

registerDashboardPlugin(welcomeMessagesPlugin);

/**
 * Treats a config row's `data` as new-shape when it carries either of the
 * new keys (`message` / `roles`). Anything else — an empty object or a flat
 * `{ <roleId>: "<message>" }` map produced by the old per-role schema — is a
 * legacy row that must be split into per-message configs.
 */
function isNewShape(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  return "message" in data || "roles" in data;
}

/**
 * One-shot, idempotent migration from the old welcome-message modeling into
 * the unified per-message config shape. Sources existing content from:
 *   1. legacy per-role config rows whose `data` is a flat
 *      `{ <roleId>: "<message>" }` map, and
 *   2. obsolete `welcome_message_<roleId>` variables.
 * For every role that has a non-empty message it creates one config row with
 * `{ message, roles: [roleId] }`, then deletes the legacy rows and variables.
 *
 * Re-running is a no-op: once converted there are no legacy-shaped rows and no
 * legacy variables left to pick up, and freshly-seeded new-shape rows are
 * skipped by `isNewShape`.
 */
export async function migrateWelcomeMessages(): Promise<void> {
  try {
    const rows = await storage.pluginConfigs.getByTypeAndPlugin(
      "dashboard",
      welcomeMessagesPlugin.id,
    );
    const legacyRows = rows.filter((r) => !isNewShape(r.data));
    const legacyVars = await storage.variables.getByNamePrefix(
      LEGACY_VARIABLE_PREFIX,
    );

    if (legacyRows.length === 0 && legacyVars.length === 0) return;

    const roles = await storage.users.getAllRoles();
    const roleNameById = new Map(roles.map((r) => [r.id, r.name]));

    // roleId -> { message, enabled }. Config rows take precedence over legacy
    // variables for both the message body and the enabled state. Variables had
    // no enabled concept of their own — they were shown whenever the plugin was
    // active — so they migrate as enabled. A disabled legacy config row carries
    // its disabled state onto every message it produces.
    const byRole = new Map<string, { message: string; enabled: boolean }>();
    for (const v of legacyVars) {
      const roleId = v.name.slice(LEGACY_VARIABLE_PREFIX.length);
      if (roleId && typeof v.value === "string" && v.value.trim()) {
        byRole.set(roleId, { message: v.value, enabled: true });
      }
    }
    for (const row of legacyRows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      for (const [roleId, value] of Object.entries(data)) {
        if (typeof value === "string" && value.trim()) {
          byRole.set(roleId, { message: value, enabled: row.enabled });
        }
      }
    }

    // Create the new per-message rows and remove the legacy rows/variables
    // atomically. Without a single transaction a partial failure (some creates
    // committed, cleanup skipped) would leave the legacy sources in place and
    // re-create duplicates on the next boot, defeating idempotency.
    await runInTransaction(async () => {
      let ordering = 0;
      for (const [roleId, { message, enabled }] of byRole) {
        await storage.pluginConfigs.create({
          pluginType: "dashboard",
          pluginId: welcomeMessagesPlugin.id,
          enabled,
          name: roleNameById.get(roleId) ?? null,
          ordering: ordering++,
          data: { message, roles: [roleId] },
        });
      }

      for (const row of legacyRows) {
        await storage.pluginConfigs.delete(row.id);
      }
      await storage.variables.deleteByNamePrefix(LEGACY_VARIABLE_PREFIX);
    });

    logger.info(
      `Migrated welcome messages: ${byRole.size} per-message config(s) created`,
      { service: SERVICE },
    );
  } catch (error) {
    logger.error("Failed to migrate welcome messages", {
      service: SERVICE,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
