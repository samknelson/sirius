import { describe, expect, it, vi, beforeEach } from "vitest";

const { buildContext, checkAccessInline } = vi.hoisted(() => ({
  buildContext: vi.fn(),
  checkAccessInline: vi.fn(),
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  buildContext,
  checkAccessInline,
}));

import {
  assertAdminTestPaymentAuthority,
  assertAdminPaymentAuthority,
  assertOnlinePaymentAuthority,
  OnlinePaymentAuthorityError,
} from "../../server/modules/ledger/online-payment-authority";
import payPolicy from "../../shared/access-policies/employer/ledger-pay";
import methodsPolicy from "../../shared/access-policies/employer/ledger-methods";

function request(session: Record<string, unknown> = {}) {
  return { session } as any;
}

describe("assertOnlinePaymentAuthority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildContext.mockResolvedValue({ user: { id: "user-1", email: "u@example.test" } });
    checkAccessInline.mockResolvedValue({ granted: true });
  });

  it("allows a worker only through the capability policy and returns effective id", async () => {
    checkAccessInline.mockResolvedValueOnce({ granted: false }).mockResolvedValueOnce({ granted: true });
    await expect(assertOnlinePaymentAuthority(request(), "worker", "worker-1", "pay"))
      .resolves.toBe("user-1");
    expect(checkAccessInline).toHaveBeenCalledWith(request(), "worker.ledger.pay", "worker-1");
    expect(checkAccessInline).not.toHaveBeenCalledWith(expect.anything(), "employer.mine", expect.anything());
  });

  it("rejects staff before entity authorization", async () => {
    checkAccessInline.mockResolvedValueOnce({ granted: true });
    await expect(assertOnlinePaymentAuthority(request(), "worker", "worker-1", "methods"))
      .rejects.toMatchObject({ status: 403 });
    expect(checkAccessInline).toHaveBeenCalledTimes(1);
  });

  it("uses the masqueraded user's identity and fresh capability on every request", async () => {
    buildContext.mockImplementation(async (req) => ({
      user: { id: req.session?.masqueradeUserId ?? "staff-user" },
    }));
    const grants = new Set(["target:worker.ledger.pay:worker-1", "target:worker.ledger.methods:worker-1",
      "contact:employer.ledger.pay.own:emp-1"]);
    checkAccessInline.mockImplementation(async (req, policy, entityId) => {
      const actor = req.session?.masqueradeUserId ?? "staff-user";
      if (policy === "staff") return { granted: actor === "staff-user" };
      return { granted: grants.has(`${actor}:${policy}:${entityId}`) };
    });
    const target = request({ masqueradeUserId: "target", originalUserId: "staff-user" });
    const contact = request({ masqueradeUserId: "contact", originalUserId: "staff-user" });
    await expect(assertOnlinePaymentAuthority(target, "worker", "worker-1", "pay")).resolves.toBe("target");
    await expect(assertOnlinePaymentAuthority(target, "worker", "worker-1", "methods")).resolves.toBe("target");
    await expect(assertOnlinePaymentAuthority(target, "worker", "worker-2", "pay")).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    await expect(assertOnlinePaymentAuthority(contact, "employer", "emp-1", "pay")).resolves.toBe("contact");
    await expect(assertOnlinePaymentAuthority(contact, "employer", "emp-1", "methods")).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    await expect(assertOnlinePaymentAuthority(contact, "employer", "emp-2", "pay")).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    grants.delete("contact:employer.ledger.pay.own:emp-1");
    await expect(assertOnlinePaymentAuthority(contact, "employer", "emp-1", "pay")).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    grants.delete("target:worker.ledger.pay:worker-1");
    await expect(assertOnlinePaymentAuthority(target, "worker", "worker-1", "pay")).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    await expect(assertOnlinePaymentAuthority(request({ masqueradeUserId: "other", originalUserId: "staff-user" }), "worker", "worker-1", "pay"))
      .rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    await expect(assertOnlinePaymentAuthority(request(), "worker", "worker-1", "pay")).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
  });

  it("uses the employer capability policy directly for fresh assignments", async () => {
    checkAccessInline.mockResolvedValue({ granted: true });
    await expect(assertOnlinePaymentAuthority(request(), "employer", "emp-1", "methods"))
      .resolves.toBe("user-1");
    expect(checkAccessInline).toHaveBeenCalledWith(request(), "employer.ledger.methods.manage.own", "emp-1");
    expect(checkAccessInline).not.toHaveBeenCalledWith(expect.anything(), "staff");
    expect(checkAccessInline).not.toHaveBeenCalledWith(expect.anything(), "employer.mine", expect.anything());
  });
});

describe.each([payPolicy, methodsPolicy])("$id permission and live-assignment boundary", (policy) => {
  it("requires each independent permission and checks every employer afresh, even for staff/admin", async () => {
    // Use the real evaluator to cover component gating, bypass and cache behavior.
    const { evaluatePolicy } = await vi.importActual<typeof import("../../server/services/access-policy-evaluator")>(
      "../../server/services/access-policy-evaluator",
    );
    const actor = { id: "effective-contact", email: "contact@example.test" } as any;
    const permissions = new Set(["staff", "admin"]);
    const assignments = new Set(["contact-1:emp-1", "contact-1:emp-2"]);
    const storage = {
      contacts: { getContactByEmail: vi.fn(async () => ({ id: "contact-1" })) },
      employerContacts: { hasAssignment: vi.fn(async (contactId: string, employerId: string) =>
        assignments.has(`${contactId}:${employerId}`)) },
    };
    const access = {
      hasPermission: async (_id: string, key: string) => permissions.has(key),
      getUserPermissions: async () => [...permissions],
      getUser: async () => actor,
    };
    let enabled = true;
    const check = (employerId?: string, user = actor) => evaluatePolicy(
      user, policy.id, storage, access, async () => enabled, employerId,
    );

    expect((await check("emp-1")).granted).toBe(false); // Assignment + staff/admin isn't enough.
    const other = policy.id === payPolicy.id ? methodsPolicy.id : payPolicy.id;
    permissions.add(other);
    expect((await check("emp-1")).granted).toBe(false); // Independent capabilities.
    permissions.add(policy.id);
    for (const id of ["emp-1", "emp-2"]) expect((await check(id)).granted).toBe(true);
    expect((await check("emp-3")).granted).toBe(false); // Permission alone isn't enough.
    assignments.delete("contact-1:emp-1");
    expect((await check("emp-1")).granted).toBe(false); // Previously allowed; no cache.
    assignments.add("other-contact:emp-1");
    expect((await check("emp-1")).granted).toBe(false); // Reassigned to someone else.
    assignments.add("contact-1:emp-1");
    expect((await check("emp-1")).granted).toBe(true);
    permissions.delete(policy.id);
    expect((await check("emp-1")).granted).toBe(false);
    permissions.add(policy.id);
    enabled = false;
    expect((await check("emp-1")).granted).toBe(false);
    enabled = true;
    expect((await check()).granted).toBe(false);
    expect((await check("emp-1", null)).granted).toBe(false);
    storage.contacts.getContactByEmail.mockResolvedValueOnce(null as any);
    expect((await check("emp-1")).granted).toBe(false);
    // The original staff contact's assignment never supplies the effective user's contact.
    storage.contacts.getContactByEmail.mockResolvedValueOnce({ id: "other-contact" });
    expect((await check("emp-2")).granted).toBe(false);
    expect(storage.employerContacts.hasAssignment).toHaveBeenLastCalledWith("other-contact", "emp-2");
  });
});

describe("assertAdminTestPaymentAuthority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildContext.mockResolvedValue({ user: { id: "admin-1" } });
    checkAccessInline.mockResolvedValue({ granted: true });
  });

  it("requires authenticated admin authority and returns the acting admin id", async () => {
    await expect(assertAdminTestPaymentAuthority(request())).resolves.toBe("admin-1");
    expect(checkAccessInline).toHaveBeenCalledWith(request(), "admin");
  });

  it("denies non-admin users", async () => {
    checkAccessInline.mockResolvedValue({ granted: false });
    await expect(assertAdminTestPaymentAuthority(request())).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
  });

  it("refuses to use a masqueraded identity", async () => {
    await expect(assertAdminTestPaymentAuthority(request({ masqueradeUserId: "worker-1" })))
      .rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    expect(buildContext).not.toHaveBeenCalled();
  });
});

describe("administrator on-behalf authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildContext.mockResolvedValue({ user: { id: "admin-1" } });
    checkAccessInline.mockResolvedValue({ granted: true });
  });
  it("requires the administrator's own identity, not a payer link or masquerade", async () => {
    await expect(assertAdminPaymentAuthority(request())).resolves.toBe("admin-1");
    expect(checkAccessInline).toHaveBeenCalledWith(request(), "admin");
    await expect(assertAdminPaymentAuthority(request({ masqueradeUserId: "worker-1" }))).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    checkAccessInline.mockResolvedValue({ granted: false });
    await expect(assertAdminPaymentAuthority(request())).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    buildContext.mockResolvedValue({ user: null });
    await expect(assertAdminPaymentAuthority(request())).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
  });
});