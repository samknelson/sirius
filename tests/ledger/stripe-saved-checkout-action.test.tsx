// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({
  handleNextAction: vi.fn(),
  confirmPayment: vi.fn(),
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: () => Promise.resolve(stripe) }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => stripe,
  useElements: () => ({}),
}));

import { StripePayComponent } from "@/plugins/payment-gateway/stripe/StripePayComponent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("Stripe saved-method checkout action", () => {
  it("handles a saved card's 3DS challenge using the existing intent secret", async () => {
    const onComplete = vi.fn();
    stripe.handleNextAction.mockResolvedValue({ paymentIntent: { status: "succeeded" } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<StripePayComponent clientSecret="pi_saved_secret" publicConfig={{ publishableKey: "pk_test_fixture" }}
        amount="$12.00" savedMethod returnUrl="https://example.test/pay/receipt/session-1" onComplete={onComplete} />);
    });
    expect(container.querySelector('[data-testid="payment-element"]')).toBeNull();
    await act(async () => {
      (container!.querySelector('[data-testid="button-confirm-stripe-pay"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(stripe.handleNextAction).toHaveBeenCalledWith({ clientSecret: "pi_saved_secret" });
    expect(stripe.confirmPayment).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith("processing");
  });
});