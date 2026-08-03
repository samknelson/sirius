import { z } from "zod";
import { storage } from "../../storage";
import { isFileSystemConfigured, listFileSystemConfigs } from "../files";
import { getEntityFileContext, listEntityFileContexts } from "./registry";

/**
 * Operator configuration for the entity-files framework: ONE variable
 * (`entity_files_config`) holding a per-context map:
 *
 *   { "<contextId>": { file_system, directory, allowed? } }
 *
 * - `file_system`: id of a filesystem from the FILESYSTEMS env config.
 * - `directory`: directory template; may embed the context's tokens
 *   (e.g. "grievances/:grievance-id"). Leading/trailing slashes are ignored.
 * - `allowed`: optional list of allowed file extensions (no dot, case
 *   insensitive, e.g. ["pdf","docx"]). Absent/empty = all extensions.
 *
 * The variable is edited through the generic variable routes; the schema
 * below is enforced there via the variable registry.
 */

export const ENTITY_FILES_CONFIG_VARIABLE = "entity_files_config";

const contextConfigSchema = z.object({
  file_system: z.string().min(1),
  directory: z
    .string()
    .min(1)
    .refine((d) => !d.includes(".."), { message: "directory must not contain '..'" }),
  allowed: z
    .array(
      z
        .string()
        .min(1)
        .transform((e) => e.replace(/^\./, "").toLowerCase()),
    )
    .optional(),
});

export type EntityFilesContextConfig = z.infer<typeof contextConfigSchema>;

/**
 * Full value schema. Rejects unknown context ids and directory templates
 * that reference tokens the context does not provide, so a typo cannot be
 * saved and silently break uploads later.
 */
export const entityFilesConfigSchema = z
  .record(z.string(), contextConfigSchema)
  .superRefine((value, ctx) => {
    for (const [contextId, config] of Object.entries(value)) {
      const context = getEntityFileContext(contextId);
      if (!context) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [contextId],
          message: `Unknown entity file context "${contextId}". Known: ${listEntityFileContexts()
            .map((c) => c.id)
            .join(", ") || "(none)"}`,
        });
        continue;
      }
      if (!isFileSystemConfigured(config.file_system)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [contextId, "file_system"],
          message: `Unknown filesystem "${config.file_system}". Configured: ${listFileSystemConfigs()
            .map((f) => f.id)
            .join(", ") || "(none)"}`,
        });
      }
      const tokensInDirectory = config.directory.match(/:[a-z0-9-]+/gi) ?? [];
      for (const token of tokensInDirectory) {
        if (!context.tokens.includes(token)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [contextId, "directory"],
            message: `Unknown token "${token}" for context "${contextId}". Available: ${context.tokens.join(", ") || "(none)"}`,
          });
        }
      }
    }
  });

export type EntityFilesConfig = z.infer<typeof entityFilesConfigSchema>;

/** Read the stored config for one context; undefined when not configured. */
export async function getEntityFilesContextConfig(
  contextId: string,
): Promise<EntityFilesContextConfig | undefined> {
  const variable = await storage.variables.getByName(ENTITY_FILES_CONFIG_VARIABLE);
  if (!variable?.value || typeof variable.value !== "object") return undefined;
  const parsed = contextConfigSchema.safeParse(
    (variable.value as Record<string, unknown>)[contextId],
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * A context is usable when it has a config entry AND the referenced
 * filesystem is actually defined in the environment. Returns a
 * human-readable reason when unusable.
 */
export async function resolveUsableContextConfig(
  contextId: string,
): Promise<{ config: EntityFilesContextConfig } | { config?: undefined; reason: string }> {
  const config = await getEntityFilesContextConfig(contextId);
  if (!config) {
    return { reason: "File attachments are not configured for this area. An administrator must configure them under Config → Entity Files." };
  }
  if (!isFileSystemConfigured(config.file_system)) {
    return {
      reason: `The configured filesystem "${config.file_system}" is not defined in the FILESYSTEMS environment configuration.`,
    };
  }
  return { config };
}

/** Expand the directory template with resolved token values. */
export function expandDirectoryTemplate(
  directory: string,
  tokenValues: Record<string, string>,
): string {
  let expanded = directory;
  for (const [token, value] of Object.entries(tokenValues)) {
    // Token values come from our own storage (entity ids); sanitize anyway.
    const safe = value.replace(/[^\w.\-]+/g, "_");
    expanded = expanded.split(token).join(safe);
  }
  return expanded.replace(/^\/+|\/+$/g, "");
}

/** Extension allow-list check ("" extension = file with no extension). */
export function isExtensionAllowed(
  fileName: string,
  allowed: string[] | undefined,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  const match = fileName.match(/\.([^.]+)$/);
  const ext = match ? match[1].toLowerCase() : "";
  return allowed.includes(ext);
}
