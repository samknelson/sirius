import { setEntityFilesReadAccessResolver } from "@shared/access-policies/file/read";
import { getEntityFileContext } from "./registry";
import { logger } from "../../logger";

/**
 * Wire the `file.read` access policy to the entity-files registry so that a
 * file whose entityType is `entity-files:<context>` is readable by anyone
 * the context's own access callback would allow to view that entity's
 * files. Fails closed: unknown context, disabled component, or a thrown
 * callback all deny (the policy's uploader/staff shortcuts still apply).
 */
export function wireEntityFilesFileReadAccess(): void {
  setEntityFilesReadAccessResolver(async (contextId, entityId, ctx) => {
    try {
      const context = getEntityFileContext(contextId);
      if (!context) return false;
      if (context.component && !(await ctx.isComponentEnabled(context.component))) {
        return false;
      }
      return await context.checkPolicyAccess("view", entityId, ctx);
    } catch (error) {
      logger.error("entity-files file.read resolver failed", {
        service: "entityFiles",
        contextId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  });
}
