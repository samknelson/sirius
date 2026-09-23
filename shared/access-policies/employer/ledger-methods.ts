import { definePolicy, registerPolicy, type PolicyContext } from "../index";
const policy = definePolicy({
  id: "employer.ledger.methods",
  description: "Manage employer payment methods with an explicit contact grant",
  scope: "entity",
  entityType: "employer",
  component: "ledger",
  noAdminBypass: true,
  skipCache: true,
  async evaluate(ctx: PolicyContext) {
    if (!(await ctx.hasPermission("employer.ledger.methods")) || !(await ctx.entityId)) return { granted: false, reason: "Payment grant required" };
    const contact = await ctx.getUserContact();
    const ok = contact && await ctx.storage.employerContacts?.hasPaymentGrantForUser?.(ctx.user.id, ctx.entityId, "methods");
    return { granted: !!ok, reason: ok ? "Explicit payment grant" : "No active payment grant" };
  },
});
registerPolicy(policy);
export default policy;