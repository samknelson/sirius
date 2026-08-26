import { z } from "zod";
import { logger } from "../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../_core";
import { eventNotifierRegistry } from "./registry";
import { ALL_NOTIFICATION_MEDIA, type NotificationMedium } from "./types";

export { eventNotifierRegistry, registerEventNotifier } from "./registry";
export type * from "./types";

const MEDIA_CHOICES: { value: NotificationMedium; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "inapp", label: "In-App" },
  { value: "postal", label: "Postal" },
];

let kindRegistered = false;
function registerEventNotifierKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "event-notifier",
    registry: eventNotifierRegistry,
    label: "Event Notifiers",
    description:
      "Listen to events on the event bus and send notifications via the comm send functions.",
    // Configuring which events fan out to which channels is admin-only
    // infrastructure, so the manifest + generic CRUD routes are gated on the
    // admin policy (mirrors client-injection / charge / trust-eligibility).
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    // Resolve the manifest's `enabled` flag and the per-impl settings form
    // schema from the unified `plugin_configs` store. A plugin may have several
    // rows; the canonical one for the manifest flag is the first by
    // (ordering, id) — matching client-injection / dashboard.
    decorateEntries: async (entries) => {
      const { storage } = await import("../../storage");
      const {
        getSiteEnabledTemplateChannels,
        hideUndeliverableTemplateChannels,
      } = await import("./template-schema");
      // Which template channels the site can deliver on right now — used
      // below to hide medium cards a notifier will never send over.
      const siteChannels = await getSiteEnabledTemplateChannels();
      const configs =
        await storage.pluginConfigs.getByKind("event-notifier");
      const firstByPlugin = new Map<string, (typeof configs)[number]>();
      for (const c of configs) {
        const cur = firstByPlugin.get(c.pluginId);
        if (
          !cur ||
          c.ordering < cur.ordering ||
          (c.ordering === cur.ordering && c.id < cur.id)
        ) {
          firstByPlugin.set(c.pluginId, c);
        }
      }
      return entries.map((entry) => {
        const row = firstByPlugin.get(entry.id);
        const impl = eventNotifierRegistry.get(entry.id);
        return {
          ...entry,
          enabled: row ? row.enabled : false,
          // Serve a schema where template channel groups this notifier
          // can't deliver to (not in its supportedMedia, or the site has
          // the channel off) are marked hidden. The groups stay declared
          // so RJSF preserves any stored override for a hidden medium.
          configSchema: hideUndeliverableTemplateChannels(
            impl?.configSchema as Record<string, unknown> | undefined,
            impl?.supportedMedia ?? [],
            siteChannels,
          ) as import("./types").EventNotifierManifestEntry["configSchema"],
          uiSchema: impl?.uiSchema,
        };
      });
    },
    // Validate a unified plugin_configs `data` payload. Two layers run here:
    //   1. The admin-selected `media` (folded into `data.media` by the adapter's
    //      `toRows`) must be a subset of the plugin's declared `supportedMedia`.
    //   2. The remaining `data` is validated against the impl's own JSON schema
    //      (when it declares one). `media` is stripped first because it is an
    //      envelope field, not part of the impl's editable settings schema.
    validateConfig: async (plugin, config) => {
      const cfg = (config ?? {}) as Record<string, unknown>;
      const selected = Array.isArray(cfg.media)
        ? (cfg.media as string[])
        : [];
      const supported = plugin.supportedMedia ?? [];
      const unsupported = selected.filter(
        (m) => !supported.includes(m as NotificationMedium),
      );
      if (unsupported.length > 0) {
        return {
          valid: false,
          errors: [
            `Unsupported media for "${plugin.name}": ${unsupported.join(", ")}. ` +
              `Supported: ${supported.join(", ") || "(none)"}.`,
          ],
        };
      }
      // Staff recipients may only be staff/admin users. The recipients are
      // operator-supplied (`data.staffRecipientUserIds`) and a direct API
      // write could otherwise smuggle in arbitrary user ids, so re-check
      // membership here at save time (the legacy staff-alert framework enforced
      // the same constraint). Applies to staff-mode notifiers AND any config
      // that carries a staff recipient list (e.g. per-config recipient kinds).
      if (plugin.staffNotification || Array.isArray(cfg.staffRecipientUserIds)) {
        const ids = Array.isArray(cfg.staffRecipientUserIds)
          ? (cfg.staffRecipientUserIds as unknown[]).filter(
              (v): v is string => typeof v === "string",
            )
          : [];
        if (ids.length > 0) {
          const { storage } = await import("../../storage");
          const allowed = await storage.users.getUsersWithAnyPermission([
            "staff",
            "admin",
          ]);
          const allowedIds = new Set(allowed.map((u) => u.id));
          const invalid = ids.filter((id) => !allowedIds.has(id));
          if (invalid.length > 0) {
            return {
              valid: false,
              errors: [
                `Recipients for "${plugin.name}" must be staff or admin users. ` +
                  `${invalid.length} selected user(s) are not eligible.`,
              ],
            };
          }
        }
      }
      // Token-templated notifiers: validate every custom template's tokens at
      // save time against the notifier's event entity kind, so an invalid
      // token surfaces to the author instead of rendering as "[unknown
      // token: …]" in an outgoing message. Applies to direct API writes too.
      if (plugin.tokenTemplates) {
        const templates = cfg.templates;
        if (templates && typeof templates === "object") {
          const { extractTokenExpressions } = await import("@shared/tokens");
          const { validateTokenExpressionForRoots } = await import("../tokens");
          const { notifierTokenRootNames } = await import("./token-roots");
          // The SAME list the editor is built from, so a token the token
          // browser offered can never be rejected here — and one it never
          // offered (an employer picked out of thin air) is refused.
          const rootNames = notifierTokenRootNames(plugin.tokenTemplates.roots);
          const errors: string[] = [];
          for (const [channel, fields] of Object.entries(
            templates as Record<string, unknown>,
          )) {
            if (!fields || typeof fields !== "object") continue;
            for (const [field, value] of Object.entries(
              fields as Record<string, unknown>,
            )) {
              if (typeof value !== "string") continue;
              for (const expr of extractTokenExpressions(value)) {
                const v = validateTokenExpressionForRoots(expr, rootNames);
                if (!v.ok) {
                  errors.push(`${channel}.${field}: {{${expr}}} — ${v.error}`);
                }
              }
            }
          }
          // The in-app link template must itself start as a relative
          // path — it may not begin with a token or an absolute/scheme
          // URL. (Render-time enforcement in composeFromTemplates is
          // the backstop for token-substituted values.)
          const inapp = (templates as Record<string, unknown>).inapp;
          const linkUrl =
            inapp && typeof inapp === "object"
              ? (inapp as Record<string, unknown>).linkUrl
              : undefined;
          if (typeof linkUrl === "string" && linkUrl.trim() !== "") {
            const { isSafeRelativePath } = await import("./token-templates");
            if (!isSafeRelativePath(linkUrl.trim())) {
              errors.push(
                'inapp.linkUrl: must be a relative path starting with "/" (not "//" or an absolute URL)',
              );
            }
          }
          if (errors.length > 0) {
            return {
              valid: false,
              errors: errors.map((e) => `Invalid template token (${e})`),
            };
          }
        }
      }
      if (!plugin.configSchema) return { valid: true };
      const { validateAgainstSchema } = await import(
        "../../lib/json-schema-validator"
      );
      const { media: _media, ...rest } = cfg;
      const result = validateAgainstSchema(plugin.configSchema, rest);
      return { valid: result.valid, errors: result.errors };
    },
  });
  // Event-notifier configs hoist the admin's active-media selection into a real
  // subsidiary column (`plugin_configs_event_notifier.media`) so the generic
  // admin page can render and filter on it. The editable per-impl settings ride
  // in `data`; `media` is mirrored into `data.media` purely so `validateConfig`
  // can enforce the supportedMedia subset (RJSF strips it from the impl form).
  registerPluginConfigAdapter({
    pluginKind: "event-notifier",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      media: z
        .union([z.string(), z.array(z.string())])
        .nullable()
        .optional(),
    }),
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
      media: z.string().nullable().optional(),
    }),
    toRows: (input) => {
      // Resolve the selected media from whichever source provided it: a
      // programmatic caller may send an array on `data.media`; the generic admin
      // page sends a comma-joined string on the top-level `media` envelope field
      // (RJSF strips it from `data` since it's not in the impl JSON Schema).
      const dataObj =
        input.data && typeof input.data === "object"
          ? (input.data as Record<string, unknown>)
          : {};
      const dataMedia = dataObj.media;
      const mediaArr = Array.isArray(dataMedia)
        ? (dataMedia as string[])
        : typeof input.media === "string" && input.media.length > 0
          ? input.media
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : Array.isArray(input.media)
            ? (input.media as string[])
            : [];
      const media = mediaArr.length > 0 ? mediaArr.join(",") : null;
      return {
        base: {
          pluginKind: "event-notifier",
          pluginId: input.pluginId,
          enabled: input.enabled,
          name: input.name,
          ordering: input.ordering,
          data: { ...dataObj, media: mediaArr },
        },
        subsidiary: { media },
      };
    },
    // Lift the subsidiary `media` (comma-joined string) back to the top-level
    // flat shape the admin checkbox group sends, so read -> PATCH round-trips.
    hydrate: (envelope) => {
      const base = { ...envelope.config } as Record<string, unknown>;
      const sub = (envelope.subsidiary ?? {}) as Record<string, unknown>;
      const mediaStr = typeof sub.media === "string" ? sub.media : "";
      const mediaArr = mediaStr
        ? mediaStr
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      return { ...base, media: mediaArr };
    },
    envelopeFields: [
      {
        name: "media",
        label: "Media",
        type: "string",
        multiple: true,
        filterable: true,
        options: { choices: MEDIA_CHOICES },
      },
    ],
    // Every notifier shares the Media checkbox group, but each declares its
    // own `supportedMedia` and `validateConfig` rejects anything outside it.
    // Mark the rest unavailable for the selected notifier so the admin form
    // stops offering a selection that always 400s (the server check above
    // stays authoritative — this only shapes the form).
    envelopeFieldsForPlugin: (plugin) => {
      const supported = new Set(
        (plugin as { supportedMedia?: NotificationMedium[] }).supportedMedia ?? [],
      );
      return [
        {
          name: "media",
          label: "Media",
          type: "string",
          multiple: true,
          filterable: true,
          options: {
            choices: MEDIA_CHOICES.map((choice) =>
              supported.has(choice.value)
                ? choice
                : {
                    ...choice,
                    disabled: true,
                    disabledReason: "This notifier has no message for it",
                  },
            ),
          },
        },
      ];
    },
  });
  kindRegistered = true;
}

/**
 * Idempotently ensure every event-notifier config has a subsidiary row in
 * `plugin_configs_event_notifier`. The generic search inner-joins that table,
 * so a config without a row would silently vanish from listings. New configs
 * get their row from the adapter's `toRows`; this backfill covers configs that
 * existed before the subsidiary was introduced. Runs at boot after the kind is
 * registered; re-running is a no-op.
 */
export async function backfillEventNotifierSubsidiaries(): Promise<void> {
  const { storage } = await import("../../storage");
  const configs = await storage.pluginConfigs.getByKind("event-notifier");
  for (const cfg of configs) {
    try {
      const envelope = await storage.pluginConfigs.getWithSubsidiary(cfg.id);
      if (!envelope || envelope.subsidiary) continue; // already has a row
      // Seed the media from any legacy `data.media` the config already carries.
      const data = (cfg.data ?? {}) as Record<string, unknown>;
      const legacy = Array.isArray(data.media)
        ? (data.media as string[]).filter((m) => typeof m === "string")
        : [];
      await storage.pluginConfigs.upsertSubsidiary("event-notifier", {
        id: cfg.id,
        media: legacy.length > 0 ? legacy.join(",") : null,
      });
      logger.info(`Backfilled event-notifier subsidiary for config ${cfg.id}`, {
        service: "event-notifier-plugins",
      });
    } catch (error) {
      logger.error(
        `Failed to backfill event-notifier subsidiary for config ${cfg.id}`,
        {
          service: "event-notifier-plugins",
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

/**
 * Initialize the event-notifier plugin system.
 *
 * Plugins self-register at module top level. The side-effect imports at the
 * bottom of this file load each plugin once and trigger its
 * `registerEventNotifier(...)` call. To add a new plugin: drop a file under
 * `./plugins/` and add one `import "./plugins/<name>"` line below.
 *
 * (This matches the convention used by every other plugin kind in the repo —
 * see `server/plugins/_core/README.md` → "Plugin registration convention".)
 */
export function initializeEventNotifierPluginSystem(): void {
  registerEventNotifierKind();
  logger.info("Event-notifier plugins registered", {
    service: "event-notifier-plugins",
    plugins: eventNotifierRegistry.listIds(),
  });
}

export { ALL_NOTIFICATION_MEDIA };

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/steward-assignment-notifier";
import "./plugins/trust-wmb-scan";
import "./plugins/grievance-assignment-notifier";
import "./plugins/grievance-settlement-notifier";
import "./plugins/trust-election-enrollment-notifier";
import "./plugins/grievance-status-notifier";
import "./plugins/grievance-deadline-notifier";
import "./plugins/tos-absence-notifier";
import "./plugins/edls-sheet-status-notifier";
import "./plugins/edls-sheet-worker-sms-notifier";
import "./plugins/dispatch-status-notifier";
import "./plugins/dispatch-fore-notifier";
import "./plugins/sitespecific-t631-interview";
import "./plugins/bao-case-status-notifier";
