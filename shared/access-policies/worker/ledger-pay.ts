import { definePolicy, registerPolicy, type PolicyContext } from "../index";

const policy = definePolicy({
  id: "worker.ledger.pay",
  description: "Pay for your own worker account",
  scope: "entity",
  entityType: "worker",
  component: "ledger",
  noAdminBypass: true,
  skipCache: true,
  async evaluate(ctx: PolicyContext) {
    if (!(await ctx.hasPermission("worker.ledger.pay")) || !ctx.entityId) return { granted: false, reason: "Worker payment permission required" };
    const worker = await ctx.getUserWorker();
    const ok = !!worker && worker.id === ctx.entityId;
    return { granted: ok, reason: ok ? "Own worker account" : "Not your worker account" };
  },
});
registerPolicy(policy);
export default policy;