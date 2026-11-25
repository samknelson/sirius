/**
 * Bannable actions — the code-level registry of things a worker ban can
 * prohibit. Ban plugins declare which of these actions they deny; enforcement
 * points call `isBanned(action, workerId, context)` from ./service.
 *
 * Optional components register their own actions alongside their enforcement.
 */
export interface ComponentBannableActions {}
export type BannableActionId = "dispatch.accept" | keyof ComponentBannableActions;
export const BANNABLE_ACTIONS: { id: BannableActionId; name: string }[] = [
  {
    id: "dispatch.accept",
    name: "Accepting dispatch jobs",
  },
];
export function registerBannableAction(action: { id: BannableActionId; name: string }): void {
  if (BANNABLE_ACTIONS.some(a => a.id === action.id)) throw new Error(`Duplicate bannable action: ${action.id}`);
  BANNABLE_ACTIONS.push(action);
}

export function getBannableActionName(id: string): string {
  return BANNABLE_ACTIONS.find((a) => a.id === id)?.name ?? id;
}
