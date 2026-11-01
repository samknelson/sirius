import { definePolicy, registerPolicy, type PolicyContext } from "../index";

const policy = definePolicy({
  id: "contact.email.edit",
  description: "Change a contact email as staff, admin, or the contact's owner",
  scope: "entity",
  entityType: "contact",
  skipCache: true,
  describeRequirements: () => [
    { permission: "staff" },
    { permission: "admin" },
    { attribute: "contact matches the signed-in user's current identity" },
  ],
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasAnyPermission(["staff", "admin"])) {
      return { granted: true, reason: "Staff/admin access" };
    }
    const ownContact = await ctx.getUserContact();
    return ownContact?.id === ctx.entityId
      ? { granted: true, reason: "User owns this contact" }
      : { granted: false, reason: "Only staff, administrators, or the contact's owner can change this email" };
  },
});
registerPolicy(policy);
export default policy;
