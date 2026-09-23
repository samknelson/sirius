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

  it("rejects masquerade sessions without consulting cached policy state", async () => {
    await expect(assertOnlinePaymentAuthority(request({ masqueradeUserId: "target" }), "employer", "emp-1", "pay"))
      .rejects.toBeInstanceOf(OnlinePaymentAuthorityError);
    expect(buildContext).not.toHaveBeenCalled();
    expect(checkAccessInline).not.toHaveBeenCalled();
  });

  it("uses the employer capability policy directly for fresh grants", async () => {
    checkAccessInline.mockResolvedValueOnce({ granted: false }).mockResolvedValueOnce({ granted: true });
    await expect(assertOnlinePaymentAuthority(request(), "employer", "emp-1", "methods"))
      .resolves.toBe("user-1");
    expect(checkAccessInline).toHaveBeenCalledWith(request(), "employer.ledger.methods", "emp-1");
    expect(checkAccessInline).not.toHaveBeenCalledWith(expect.anything(), "employer.mine", expect.anything());
  });
});