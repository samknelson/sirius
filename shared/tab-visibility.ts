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
