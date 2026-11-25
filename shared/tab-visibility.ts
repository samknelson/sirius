import { alterHooks } from "./alter";
import type { TabEntityType } from "./tabRegistry";

/** Visibility is presentation only, never a replacement for authorization. */
export const tabVisibilityHook = alterHooks.declare<boolean, {
  entityType: TabEntityType;
  entityId: string;
  tabId: string;
}>({
  id: "tabs.visibility",
  description: "Hide irrelevant tabs after their access checks pass",
  semantics: "Visibility only. Callbacks may hide an authorized tab, never grant access. Errors hide the tab.",
});

/**
 * The base access policy a viewer must pass before any tab of an entity is
 * evaluated (base value: core's map, or `authenticated`). A component that
 * contributes a tab tree for an entity type of its own names that type's base
 * policy here. Callbacks should only answer for entity types they own.
 */
export const tabEntityPolicyHook = alterHooks.declare<string, { entityType: TabEntityType }>({
  id: "tabs.entity-policy",
  description: "Choose the base access policy for an entity's tab batch check",
  semantics: "Return a policy id. Answer only for entity types the component owns; the check fails closed if the policy denies.",
});
