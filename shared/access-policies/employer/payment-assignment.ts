import type { PolicyContext, PolicyResult } from "../index";

/** Own-scoped payment authority never delegates to employer.mine (staff bypass). */
export async function checkEmployerPaymentAssignment(
  ctx: PolicyContext,
  permission: string,
): Promise<PolicyResult> {
  if (!ctx.user?.id || !ctx.entityId || !(await ctx.hasPermission(permission))) {
    return { granted: false, reason: "Employer payment permission and current employer assignment required" };
  }
  const contact = await ctx.getUserContact();
  const assigned = contact?.id && await ctx.storage.employerContacts?.hasAssignment?.(contact.id, ctx.entityId);
  return {
    granted: !!assigned,
    reason: assigned ? "Permitted contact currently assigned to employer" : "Current employer assignment required",
  };
}
