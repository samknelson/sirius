import { definePolicy, registerPolicy, type PolicyContext } from "../index";
import { checkEmployerPaymentAssignment } from "./payment-assignment";
const policy = definePolicy({
  id: "employer.ledger.pay.own",
  description: "Pay for any employer currently assigned to your contact",
  scope: "entity",
  entityType: "employer",
  component: "ledger",
  noAdminBypass: true,
  skipCache: true,
  async evaluate(ctx: PolicyContext) {
    return checkEmployerPaymentAssignment(ctx, "employer.ledger.pay.own");
  },
});
registerPolicy(policy);
export default policy;