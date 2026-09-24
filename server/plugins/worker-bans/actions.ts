/**
 * Bannable actions — the code-level registry of things a worker ban can
 * prohibit. Ban plugins declare which of these actions they deny; enforcement
 * points call `isBanned(action, workerId, context)` from ./service.
 *
 * Adding a new action is just adding an entry here plus wiring the relevant
 * enforcement point.
 */
export const BANNABLE_ACTIONS = [
  {
    id: "dispatch.accept",
    name: "Accepting dispatch jobs",
  },
  {
    id: "dispatch.eba",
    name: "Being listed as Employed but Available",
  },
] as const;

export type BannableActionId = (typeof BANNABLE_ACTIONS)[number]["id"];

export function getBannableActionName(id: string): string {
  return BANNABLE_ACTIONS.find((a) => a.id === id)?.name ?? id;
}
