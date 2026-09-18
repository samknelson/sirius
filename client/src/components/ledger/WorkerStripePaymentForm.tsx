import { useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export interface WorkerStripePaymentFormProps {
  clientSecret: string;
  publicConfig: Record<string, unknown>;
  amount: string;
  onComplete: (status: "succeeded" | "processing" | "failed", message?: string) => void;
}

function Form({ amount, onComplete }: Omit<WorkerStripePaymentFormProps, "publicConfig" | "clientSecret"> & {
  onComplete: WorkerStripePaymentFormProps["onComplete"];
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.href },
      });
      if (result.error) {
        onComplete("failed", result.error.message);
      } else {
        // Stripe success confirms provider collection, not the internal ledger
        // posting. The parent polls our attempt until ledgerPaymentId exists.
        onComplete("processing");
      }
    } catch (error) {
      onComplete("failed", error instanceof Error ? error.message : "Payment could not be completed.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="form-worker-stripe-payment">
      <PaymentElement />
      <Button type="submit" disabled={!stripe || !elements || processing} data-testid="button-confirm-worker-payment">
        {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Pay {amount}
      </Button>
    </form>
  );
}

export function WorkerStripePaymentForm({ clientSecret, publicConfig, amount, onComplete }: WorkerStripePaymentFormProps) {
  const key = typeof publicConfig.publishableKey === "string" ? publicConfig.publishableKey : "";
  const stripe = useMemo(() => (key ? loadStripe(key) : null), [key]);
  if (!stripe) {
    return <p className="text-sm text-destructive" data-testid="text-stripe-not-configured">Stripe payment processing is not configured.</p>;
  }
  const options: StripeElementsOptions = { clientSecret, appearance: { theme: "stripe" } };
  return <Elements stripe={stripe} options={options}><Form amount={amount} onComplete={onComplete} /></Elements>;
}