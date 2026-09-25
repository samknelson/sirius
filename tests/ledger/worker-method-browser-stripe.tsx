// Browser-only stand-in for Stripe's expanding Payment Element. The production
// Stripe form, provider handoff, consent and method-management page remain real.
import { useState, type ReactNode } from "react";

export const Elements = ({ children }: { children: ReactNode }) => <>{children}</>;
export const useElements = () => ({});
export const useStripe = () => ({
  confirmSetup: async () => ({ setupIntent: { payment_method: "pm-fixture" } }),
});
export function PaymentElement() {
  const [expanded, setExpanded] = useState(false);
  return <div data-testid="fixture-payment-element">
    <button type="button" onClick={() => setExpanded(true)}>Show optional Link fields and errors</button>
    <div className="rounded border p-3">
      <label>Card number <input aria-label="Card number" /></label>
      <iframe title="Secure card fields" srcDoc="<body style='height:280px'>Secure card entry</body>" className="w-full" style={{ height: 300 }} />
      {expanded && <div data-testid="fixture-expanded-fields" className="space-y-3">
        <label>Link email <input aria-label="Link email" /></label>
        <label>Link phone <input aria-label="Link phone" /></label>
        <p role="alert">Please check your card details.</p>
        <div style={{ height: 220 }}>Additional provider fields</div>
      </div>}
    </div>
  </div>;
}