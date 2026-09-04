import {
  parseTokenChain,
  TOKEN_PATTERN,
  type TokenSegment,
} from "@shared/tokens";
import { logger } from "../../logger";

const SERVICE = "event-notifier-plugins";

/**
 * BOOT-TIME REWRITES for admin-customised message templates.
 *
 * A notifier's default templates live in its source, so renaming a token root
 * or dropping a flattened field fixes them by editing code. Templates an admin
 * has customised do not: they are stored verbatim in the config's
 * `data.templates` and rendered verbatim at send time. Left alone, they would
 * keep addressing a root that no longer exists and every one of their tokens
 * would deliver as "[unknown token: …]".
 *
 * So each rename ships with its rewrite. Rewrites work on the PARSED chain,
 * not on the template text: the token grammar allows arguments in any order,
 * arbitrary whitespace, escaped quotes and braces inside argument values, and
 * a text-level regex gets all four wrong — quietly, on exactly the templates
 * someone took the trouble to customise. Rewrites must also be idempotent:
 * this runs on every boot.
 */
interface TemplateTokenRewrite {
  pluginId: string;
  /** Return the new chain, or null to leave the token untouched. */
  rewriteChain(segments: TokenSegment[]): TokenSegment[] | null;
}

/** A segment with one argument's VALUE replaced, keeping argument order. */
function withArg(
  segment: TokenSegment,
  name: string,
  value: string,
): TokenSegment {
  return { name: segment.name, args: { ...segment.args, [name]: value } };
}

const REWRITES: TemplateTokenRewrite[] = [
  {
    pluginId: "grievance-status-notifier",
    rewriteChain(segments) {
      const [root, next, ...rest] = segments;
      if (root.name !== "grievance_status") return null;

      // The grievance is now a root of its own, not a hop off the entry.
      if (next?.name === "grievance") {
        return [{ name: "grievance", args: next.args }, ...rest];
      }
      if (next?.name === "field") {
        const field = next.args.name;
        // `grievance_title` was a value flattened onto the status entry; the
        // grievance's own display title is the real home for it.
        if (field === "grievance_title") {
          return [
            { name: "grievance", args: root.args },
            withArg(next, "name", "display_title"),
            ...rest,
          ];
        }
        // `status_name` was flattened too; the entry's status FK renders the
        // status option's name on its own.
        if (field === "status_name") {
          return [
            { name: "grievance_status_history", args: root.args },
            withArg(next, "name", "status_id"),
            ...rest,
          ];
        }
      }
      // Everything else keeps its chain, under the root's real name.
      return [
        { name: "grievance_status_history", args: root.args },
        ...(next ? [next] : []),
        ...rest,
      ];
    },
  },
  {
    pluginId: "grievance-settlement",
    rewriteChain(segments) {
      const [root, next, ...rest] = segments;
      if (root.name !== "grievance_settlement") return null;

      // The grievance is now a root of its own, not a hop off the settlement.
      if (next?.name === "grievance") {
        return [{ name: "grievance", args: next.args }, ...rest];
      }
      // `grievance_title` was a value flattened onto the settlement; the
      // grievance's own display title is the real home for it.
      if (next?.name === "field" && next.args.name === "grievance_title") {
        return [
          { name: "grievance", args: root.args },
          withArg(next, "name", "display_title"),
          ...rest,
        ];
      }
      return null;
    },
  },
  {
    pluginId: "dispatch-status-notifier",
    rewriteChain(segments) {
      const [root, ...rest] = segments;
      // The root was named after the component, not the record it carries.
      if (root.name !== "dispatch") return null;
      return [{ name: "dispatch_worker_status", args: root.args }, ...rest];
    },
  },
  {
    pluginId: "dispatch-fore-notifier",
    rewriteChain(segments) {
      const [root, next, ...rest] = segments;
      if (root.name !== "dispatch_fore") return null;

      // The job is now a root of its own, not a hop off the membership.
      if (next?.name === "dispatch_job") {
        return [{ name: "dispatch_job", args: next.args }, ...rest];
      }
      if (next?.name === "field") {
        const field = next.args.name;
        // Both were values of the JOB flattened onto the membership row.
        if (field === "job_title") {
          return [
            { name: "dispatch_job", args: root.args },
            withArg(next, "name", "title"),
            ...rest,
          ];
        }
        // The employer FK renders the employer's name on its own.
        if (field === "employer_name") {
          return [
            { name: "dispatch_job", args: root.args },
            withArg(next, "name", "employer_id"),
            ...rest,
          ];
        }
      }
      return null;
    },
  },
];

/** Serialize a parsed chain back into a token expression. */
function serializeChain(segments: TokenSegment[]): string {
  return segments
    .map((segment) => {
      const args = Object.entries(segment.args);
      if (args.length === 0) return segment.name;
      const rendered = args
        .map(([k, v]) => `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(", ");
      return `${segment.name}(${rendered})`;
    })
    .join(".");
}

/**
 * Apply a rewrite to every token in one template string. Anything that does
 * not parse is left exactly as it is: an unparseable token is already broken,
 * and a migration that reformats it would destroy the author's text without
 * fixing anything.
 */
export function rewriteTemplateTokens(
  template: string,
  rewrite: Pick<TemplateTokenRewrite, "rewriteChain">,
): string {
  return template.replace(TOKEN_PATTERN, (whole, expr: string) => {
    const parsed = parseTokenChain(expr);
    if (!parsed.ok) return whole;
    const next = rewrite.rewriteChain(parsed.segments);
    if (!next) return whole;
    return `{{${serializeChain(next)}}}`;
  });
}

/**
 * Apply a plugin's rewrite to a config's `data`, returning the new data only
 * when something actually changed (so an unchanged config is never written).
 */
function rewriteConfigData(
  data: unknown,
  rewrite: TemplateTokenRewrite,
): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const templates = record.templates;
  if (!templates || typeof templates !== "object") return null;

  let changed = false;
  const nextTemplates: Record<string, unknown> = {};
  for (const [channel, fields] of Object.entries(
    templates as Record<string, unknown>,
  )) {
    if (!fields || typeof fields !== "object") {
      nextTemplates[channel] = fields;
      continue;
    }
    const nextFields: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(
      fields as Record<string, unknown>,
    )) {
      if (typeof value !== "string") {
        nextFields[field] = value;
        continue;
      }
      const rewritten = rewriteTemplateTokens(value, rewrite);
      if (rewritten !== value) changed = true;
      nextFields[field] = rewritten;
    }
    nextTemplates[channel] = nextFields;
  }
  if (!changed) return null;
  return { ...record, templates: nextTemplates };
}

/**
 * Bring every stored custom template up to date with the token roots its
 * notifier declares today. Idempotent; a failure on one config is logged and
 * never blocks boot (a stale template renders unknown-token markers, which is
 * bad, but refusing to start is worse).
 *
 * Safe when two tasks boot at once (Task #1350): the rewrite is a pure
 * function of the stored data, so both tasks compute the same replacement,
 * and applying it to already-rewritten data is the no-op that makes this
 * idempotent in the first place.
 */
export async function migrateNotifierTemplateTokens(): Promise<void> {
  const { storage } = await import("../../storage");
  for (const rewrite of REWRITES) {
    let configs;
    try {
      configs = await storage.pluginConfigs.getByKindAndPlugin(
        "event-notifier",
        rewrite.pluginId,
      );
    } catch (error) {
      logger.error("Could not load configs to migrate template tokens", {
        service: SERVICE,
        pluginId: rewrite.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const cfg of configs) {
      const next = rewriteConfigData(cfg.data, rewrite);
      if (!next) continue;
      try {
        await storage.pluginConfigs.update(cfg.id, { data: next });
        logger.info("Migrated custom template tokens to the current roots", {
          service: SERVICE,
          pluginId: rewrite.pluginId,
          configId: cfg.id,
        });
      } catch (error) {
        logger.error("Failed to migrate custom template tokens", {
          service: SERVICE,
          pluginId: rewrite.pluginId,
          configId: cfg.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/** The rewrites, exposed so a verification script can exercise them. */
export const NOTIFIER_TEMPLATE_REWRITES = REWRITES;
