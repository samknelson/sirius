import { useMemo, useState } from "react";
import {
  useStripe,
  useElements,
  PaymentElement,
  Elements,
} from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PaymentGatewayAddProps } from "../registry";

interface StripeFormProps {
  onSuccess: (methodToken: string) => void;
  onCancel: () => void;
}

function StripeForm({ onSuccess, onCancel }: StripeFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    try {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.href },
      });

      if (error) {
        toast({
          title: "Failed to add payment method",
          description: error.message,
          variant: "destructive",
        });
        setIsProcessing(false);
      } else if (setupIntent?.payment_method) {
        const methodToken =
          typeof setupIntent.payment_method === "string"
            ? setupIntent.payment_method
            : setupIntent.payment_method.id;
        onSuccess(methodToken);
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "An unexpected error occurred",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <div className="flex justify-end space-x-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isProcessing}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || isProcessing}
          data-testid="button-confirm-payment-method"
        >
          {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add Payment Method
        </Button>
      </div>
    </form>
  );
}

/**
 * Stripe "add a payment method" component, auto-discovered by the
 * payment-gateway client registry (id `stripe:StripeAddPaymentMethod`). The
 * publishable key arrives from the server via `publicConfig.publishableKey`, so
 * no provider-specific env var is read on the client.
 */
export function StripeAddPaymentMethod({
  clientSecret,
  publicConfig,
  onSuccess,
  onCancel,
}: PaymentGatewayAddProps) {
  const publishableKey =
    typeof publicConfig.publishableKey === "string"
      ? publicConfig.publishableKey
      : "";

  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  if (!stripePromise) {
    return (
      <div className="p-4 border border-yellow-200 bg-yellow-50 rounded">
        <p className="text-sm text-yellow-800">
          Stripe payment processing is not configured. Please contact your
          administrator to set up payment processing.
        </p>
        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const options: StripeElementsOptions = {
    clientSecret,
    appearance: { theme: "stripe" },
  };

  return (
    <Elements stripe={stripePromise} options={options}>
      <StripeForm onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}

export default StripeAddPaymentMethod;
