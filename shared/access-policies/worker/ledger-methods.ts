import { definePolicy, registerPolicy } from "../index";
const policy = definePolicy({
  id: "worker.ledger.methods",
  description: "Manage payment methods for your own worker account",
  scope: "entity",
  entityType: "worker",
  component: "ledger",
  noAdminBypass: true,
  skipCache: true,
  async evaluate(ctx) {
    if (!(await ctx.hasPermission("worker.ledger.methods")) || !ctx.entityId) return { granted: false, reason: "Worker payment-method permission required" };
    const worker = await ctx.getUserWorker();
    const ok = !!worker && worker.id === ctx.entityId;
    return { granted: ok, reason: ok ? "Own worker account" : "Not your worker account" };
  },
});
registerPolicy(policy);
export default policy;