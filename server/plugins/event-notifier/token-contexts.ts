import { MEDIUM_NAMES, type MediumName } from "@shared/delivery-fields";
import { notifierTokenContextId } from "@shared/token-contexts";
import type { TokenContextDeclaration } from "@shared/token-contexts";
// Submodule import, not the tokens barrel: the barrel pulls in every
// token plugin, and notifier plugin files are imported from it.
import { registerTokenContextSource } from "../tokens/contexts";
import { eventNotifierRegistry } from "./registry";
import { notifierTokenRootNames } from "./token-roots";

/**
 * ONE TOKEN CONTEXT PER TOKEN-TEMPLATED NOTIFIER — generated, not written.
 *
 * A notifier's roots are its own declared record roots plus the roots
 * every notifier has (see `notifierTokenRootNames`), so there is one
 * context per notifier and no honest way to hand-write them: a notifier
 * added tomorrow would ship with an editor and no context, and the
 * failure would be an admin looking at an empty token browser.
 *
 * Generated on every read, which is what makes a notifier registered
 * LATE — a component switched on after boot — bring its context with it
 * rather than needing a restart. A hand-written context of the same id
 * still wins, in either registration order; the registry, not this file,
 * decides that.
 */

function isMediumName(medium: string): medium is MediumName {
  return (MEDIUM_NAMES as readonly string[]).includes(medium);
}

export function registerNotifierTokenContexts(): void {
  registerTokenContextSource((): TokenContextDeclaration[] =>
    eventNotifierRegistry
      .list()
      .filter((plugin) => plugin.tokenTemplates)
      .map((plugin) => ({
        id: notifierTokenContextId(plugin.id),
        name: plugin.name,
        ...(plugin.description !== undefined
          ? { description: plugin.description }
          : {}),
        rootNames: notifierTokenRootNames(plugin.tokenTemplates!.roots),
        // The media this notifier can actually produce a message for.
        // `supportedMedia` is already that statement; a medium of its
        // own here would be a second one, free to disagree with the
        // template cards the admin is shown.
        media: plugin.supportedMedia.filter(isMediumName),
        ...(plugin.requiredComponent !== undefined
          ? { component: plugin.requiredComponent }
          : {}),
      })),
  );
}
