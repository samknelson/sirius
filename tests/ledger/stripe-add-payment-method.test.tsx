// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { confirmSetup, toast } = vi.hoisted(() => ({
  confirmSetup: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useElements: () => ({ id: "elements" }),
  useStripe: () => ({ confirmSetup }),
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(() => Promise.resolve({})) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { StripeAddPaymentMethod } from "@/plugins/payment-gateway/stripe/StripeAddPaymentMethod";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  confirmSetup.mockReset();
  toast.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function button() {
  return container.querySelector('[data-testid="button-confirm-payment-method"]') as HTMLButtonElement;
}

describe("Stripe payment-method setup", () => {
  it("retries local attachment without confirming the provider method twice", async () => {
    confirmSetup.mockResolvedValue({ setupIntent: { payment_method: "pm-confirmed" } });
    const onSuccess = vi.fn()
      .mockRejectedValueOnce(new Error("Database temporarily unavailable"))
      .mockResolvedValueOnce(undefined);
    await act(async () => {
      root.render(<StripeAddPaymentMethod clientSecret="seti_secret" publicConfig={{ publishableKey: "pk_test" }} onSuccess={onSuccess} onCancel={vi.fn()} />);
    });
    await act(async () => { button().click(); });
    expect(container.textContent).toContain("Retry without entering them again");
    expect(button().textContent).toContain("Retry saving");
    await act(async () => { button().click(); });
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenNthCalledWith(2, "pm-confirmed");
    expect(confirmSetup).toHaveBeenCalledTimes(1);
  });

  it("recovers from a thrown provider confirmation error", async () => {
    confirmSetup.mockRejectedValue(new Error("Provider connection failed"));
    await act(async () => {
      root.render(<StripeAddPaymentMethod clientSecret="seti_secret" publicConfig={{ publishableKey: "pk_test" }} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    });
    await act(async () => { button().click(); });
    expect(button().disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Provider connection failed",
      variant: "destructive",
    }));
  });
});