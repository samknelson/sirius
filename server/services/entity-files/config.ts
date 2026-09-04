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
 * - `directory`: directory template; may embed the single framework token
 *   `:entity-id` (e.g. "employers/:entity-id"). Leading/trailing slashes are
 *   ignored.
 * - `allowed`: optional list of allowed file extensions (no dot, case
 *   insensitive, e.g. ["pdf","docx"]). Absent/empty = all extensions.
 *
 * The variable is edited through the generic variable routes; the schema
 * below is enforced there via the variable registry.
 */

export const ENTITY_FILES_CONFIG_VARIABLE = "entity_files_config";

/**
 * The ONE directory token, supplied by the framework and offered for every
 * area: the id of the record the files hang off. A context does not declare
 * tokens and cannot add one — validation below rejects any other `:token`,
 * and expansion refuses to hand back a path that still contains one.
 */
export const ENTITY_FILES_DIRECTORY_TOKEN = ":entity-id";

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
 * that name anything other than the one framework token, so a typo cannot
 * be saved and silently break uploads later.
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
        const allowed = [ENTITY_FILES_DIRECTORY_TOKEN, ...(context.tokens ?? [])];
        if (!allowed.includes(token)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [contextId, "directory"],
            message: `Unknown token "${token}". Available for this context: ${allowed.join(", ")}.`,
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

/**
 * Expand the directory template for one entity.
 *
 * Refuses to hand back a path that still contains a `:token`: a stored
 * template naming something the framework does not supply would otherwise
 * put a literal ":whatever" segment in the object path. Validation above
 * already rejects such a template on save; this is the second, unskippable
 * check on the upload path.
 */
export function expandDirectoryTemplate(
  directory: string,
  entityId: string,
  /** Context-resolved extra tokens (fork extension; see registry `tokens`). */
  extraTokens: Record<string, string> = {},
): string {
  // Token values come from our own storage (entity ids); sanitize anyway.
  const sanitize = (value: string) => value.replace(/[^\w.\-]+/g, "_");
  // Context-declared tokens expand FIRST so a context may redefine the
  // framework token (bao-case spells its parent record as ":entity-id").
  let expanded = directory;
  for (const [token, value] of Object.entries(extraTokens)) {
    expanded = expanded.split(token).join(sanitize(value));
  }
  expanded = expanded.split(ENTITY_FILES_DIRECTORY_TOKEN).join(sanitize(entityId));
  expanded = expanded.replace(/^\/+|\/+$/g, "");
  const leftover = expanded.match(/:[a-z0-9-]+/i);
  if (leftover) {
    throw new Error(
      `Directory template "${directory}" contains unknown token "${leftover[0]}". The only directory token is "${ENTITY_FILES_DIRECTORY_TOKEN}".`,
    );
  }
  return expanded;
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
