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
  assertOnlinePaymentAuthority,
  OnlinePaymentAuthorityError,
} from "../../server/modules/ledger/online-payment-authority";

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
      "contact:employer.ledger.pay:emp-1"]);
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
    grants.delete("contact:employer.ledger.pay:emp-1");
    await expect(assertOnlinePaymentAuthority(contact, "employer", "emp-1", "pay")).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    grants.delete("target:worker.ledger.pay:worker-1");
    await expect(assertOnlinePaymentAuthority(target, "worker", "worker-1", "pay")).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    await expect(assertOnlinePaymentAuthority(request({ masqueradeUserId: "other", originalUserId: "staff-user" }), "worker", "worker-1", "pay"))
      .rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    await expect(assertOnlinePaymentAuthority(request(), "worker", "worker-1", "pay")).rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
  });

  it("uses the employer capability policy directly for fresh grants", async () => {
    checkAccessInline.mockResolvedValueOnce({ granted: false }).mockResolvedValueOnce({ granted: true });
    await expect(assertOnlinePaymentAuthority(request(), "employer", "emp-1", "methods"))
      .resolves.toBe("user-1");
    expect(checkAccessInline).toHaveBeenCalledWith(request(), "employer.ledger.methods", "emp-1");
    expect(checkAccessInline).not.toHaveBeenCalledWith(expect.anything(), "employer.mine", expect.anything());
  });
});