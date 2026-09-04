import { z } from "zod";
import { storage } from "../../storage";
import { getEntityNoteContext, listEntityNoteContexts } from "./registry";

/**
 * Operator configuration for the entity-notes framework: ONE variable
 * (`entity_notes_config`) holding a per-context map:
 *
 *   { "<contextId>": {} }
 *
 * A context's PRESENCE in the map is the whole setting — notes are on for
 * that area, off when absent. There is deliberately no `enabled: false`
 * spelling: two ways to say "off" is one too many, and the entity-files
 * framework already reads presence the same way.
 *
 * The per-context object is empty today. It exists so a future per-area
 * setting has an obvious home, and so an operator's configuration keeps the
 * same shape as `entity_files_config`.
 *
 * The variable is edited through the generic variable routes; the schema
 * below is enforced there via the variable registry.
 */

export const ENTITY_NOTES_CONFIG_VARIABLE = "entity_notes_config";

/**
 * Strict and empty: an unrecognized key is a typo, not a setting, and
 * accepting it would leave an operator believing they configured something.
 */
const contextConfigSchema = z.object({}).strict();

export type EntityNotesContextConfig = z.infer<typeof contextConfigSchema>;

/** Full value schema. Rejects unknown context ids so a typo cannot be saved. */
export const entityNotesConfigSchema = z
  .record(z.string(), contextConfigSchema)
  .superRefine((value, ctx) => {
    for (const contextId of Object.keys(value)) {
      if (!getEntityNoteContext(contextId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [contextId],
          message: `Unknown entity note context "${contextId}". Known: ${listEntityNoteContexts()
            .map((c) => c.id)
            .join(", ") || "(none)"}`,
        });
      }
    }
  });

export type EntityNotesConfig = z.infer<typeof entityNotesConfigSchema>;

/** Read the stored config for one context; undefined when notes are off there. */
export async function getEntityNotesContextConfig(
  contextId: string,
): Promise<EntityNotesContextConfig | undefined> {
  const variable = await storage.variables.getByName(ENTITY_NOTES_CONFIG_VARIABLE);
  if (!variable?.value || typeof variable.value !== "object") return undefined;
  const entry = (variable.value as Record<string, unknown>)[contextId];
  const parsed = contextConfigSchema.safeParse(entry);
  return parsed.success ? parsed.data : undefined;
}

/** Whether notes are switched on for this area. */
export async function isEntityNotesContextConfigured(contextId: string): Promise<boolean> {
  return (await getEntityNotesContextConfig(contextId)) !== undefined;
}
