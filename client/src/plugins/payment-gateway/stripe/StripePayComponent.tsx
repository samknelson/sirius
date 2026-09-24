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
  paymentTypes,
}: Pick<PaymentGatewayPayProps, "amount" | "onComplete" | "returnUrl" | "clientSecret" | "savedMethod"> & { paymentTypes: string[] }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [entryError, setEntryError] = useState("");
  const selectedType = paymentTypes.length === 1 ? paymentTypes[0] : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || (!savedMethod && (!elements || !ready || !selectedType)) || processing) return;
    setProcessing(true);
    setEntryError("");
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
      if (result.error) {
        setEntryError(result.error.message ?? "Check your payment details and try again.");
        onComplete("failed", result.error.message);
      }
      else onComplete("processing");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment could not be completed.";
      setEntryError(message);
      onComplete("failed", message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="form-stripe-pay">
      {!savedMethod && selectedType && <PaymentElement onReady={() => setReady(true)} onLoadError={() => setEntryError("Secure payment entry could not load. Check your connection and reload the page, then check this payment's status before starting another.")} />}
      {!savedMethod && !selectedType && <p role="alert">The provider did not return a single selected payment type. Check this payment's status before trying again.</p>}
      {entryError && <p role="alert" className="text-sm text-destructive">{entryError}</p>}
      <Button type="submit" disabled={!stripe || (!savedMethod && (!elements || !ready || !selectedType)) || processing} data-testid="button-confirm-stripe-pay">
        {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {savedMethod ? `Complete verification for ${amount}` : selectedType === "us_bank_account" ? `Confirm bank transfer of ${amount}` : `Confirm card payment of ${amount}`}
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
  const paymentTypes = Array.isArray(publicConfig.paymentTypes)
    ? publicConfig.paymentTypes.filter((type): type is string => typeof type === "string")
    : [];
  return (
    <Elements stripe={stripe} options={options}>
      <StripePaymentForm amount={amount} onComplete={onComplete} returnUrl={returnUrl} clientSecret={clientSecret} savedMethod={savedMethod} paymentTypes={paymentTypes} />
    </Elements>
  );
}

export default StripePayComponent;