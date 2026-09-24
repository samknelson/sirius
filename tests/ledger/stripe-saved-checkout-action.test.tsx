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
  PaymentElement: ({ onReady, onLoadError }: { onReady: () => void; onLoadError: () => void }) =>
    <div data-testid="payment-element"><button onClick={onReady}>Provider ready</button><button onClick={onLoadError}>Provider load error</button></div>,
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
  it.each([
    ["card", "Confirm card payment of $12.00"],
    ["us_bank_account", "Confirm bank transfer of $12.00"],
  ])("requires secure %s entry readiness before provider confirmation", async (type, label) => {
    const onComplete = vi.fn();
    stripe.confirmPayment.mockResolvedValue({ paymentIntent: { status: "processing" } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<StripePayComponent clientSecret="pi_new_secret" publicConfig={{ publishableKey: "pk_test_fixture", paymentTypes: [type] }}
        amount="$12.00" returnUrl="https://example.test/pay/receipt/session-1" onComplete={onComplete} />);
    });
    const submit = container.querySelector('[data-testid="button-confirm-stripe-pay"]') as HTMLButtonElement;
    expect(submit.textContent).toContain(label);
    expect(submit.disabled).toBe(true);
    await act(async () => { (container!.querySelector('[data-testid="payment-element"] button') as HTMLButtonElement).click(); });
    expect(submit.disabled).toBe(false);
    await act(async () => { submit.click(); await Promise.resolve(); });
    expect(stripe.confirmPayment).toHaveBeenCalledWith(expect.objectContaining({
      redirect: "if_required", confirmParams: { return_url: "https://example.test/pay/receipt/session-1" },
    }));
    expect(onComplete).toHaveBeenCalledWith("processing");
  });

  it("blocks a provider response without a single selected type and reports loading failures", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<StripePayComponent clientSecret="pi_new_secret" publicConfig={{ publishableKey: "pk_test_fixture", paymentTypes: ["card", "us_bank_account"] }}
        amount="$12.00" returnUrl="https://example.test/pay/receipt/session-1" onComplete={vi.fn()} />);
    });
    expect(container.querySelector('[data-testid="payment-element"]')).toBeNull();
    expect(container.textContent).toContain("single selected payment type");
    expect((container.querySelector('[data-testid="button-confirm-stripe-pay"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      root!.render(<StripePayComponent clientSecret="pi_new_secret" publicConfig={{ publishableKey: "pk_test_fixture", paymentTypes: ["card"] }}
        amount="$12.00" returnUrl="https://example.test/pay/receipt/session-1" onComplete={vi.fn()} />);
    });
    await act(async () => { (container!.querySelectorAll('[data-testid="payment-element"] button')[1] as HTMLButtonElement).click(); });
    expect(container.textContent).toContain("Secure payment entry could not load");
  });
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