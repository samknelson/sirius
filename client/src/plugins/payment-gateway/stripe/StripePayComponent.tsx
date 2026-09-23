import { useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { PaymentGatewayPayProps } from "../registry";

function StripePaymentForm({
  amount,
  onComplete,
  returnUrl,
  clientSecret,
  savedMethod,
}: Pick<PaymentGatewayPayProps, "amount" | "onComplete" | "returnUrl" | "clientSecret" | "savedMethod">) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || (!savedMethod && !elements) || processing) return;
    setProcessing(true);
    try {
      const result = savedMethod
        ? await stripe.handleNextAction({ clientSecret })
        : await stripe.confirmPayment({
          elements: elements!,
          redirect: "if_required",
          // Stripe may leave the page for 3DS. Returning to the receipt
          // reconciles the attempt from the server/webhook.
          confirmParams: { return_url: returnUrl },
        });
      if (result.error) onComplete("failed", result.error.message);
      else onComplete("processing");
    } catch (error) {
      onComplete(
        "failed",
        error instanceof Error ? error.message : "Payment could not be completed.",
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="form-stripe-pay">
      {!savedMethod && <PaymentElement />}
      <Button type="submit" disabled={!stripe || (!savedMethod && !elements) || processing} data-testid="button-confirm-stripe-pay">
        {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {savedMethod ? `Complete verification for ${amount}` : `Pay ${amount}`}
      </Button>
    </form>
  );
}

export function StripePayComponent({
  clientSecret,
  publicConfig,
  amount,
  onComplete,
  returnUrl,
  savedMethod,
}: PaymentGatewayPayProps) {
  const publishableKey =
    typeof publicConfig.publishableKey === "string"
      ? publicConfig.publishableKey
      : "";
  const stripe = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );
  if (!stripe) {
    return (
      <p className="text-sm text-destructive" data-testid="text-stripe-not-configured">
        Stripe payment processing is not configured.
      </p>
    );
  }
  const options: StripeElementsOptions = {
    clientSecret,
    appearance: { theme: "stripe" },
  };
  return (
    <Elements stripe={stripe} options={options}>
      <StripePaymentForm amount={amount} onComplete={onComplete} returnUrl={returnUrl} clientSecret={clientSecret} savedMethod={savedMethod} />
    </Elements>
  );
}

export default StripePayComponent;