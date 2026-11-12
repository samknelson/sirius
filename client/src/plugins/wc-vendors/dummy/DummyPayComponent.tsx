import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { PaymentGatewayPayProps } from "../registry";

/**
 * The dummy server synthesizes the result when the session is created; it has
 * no client-side confirmation protocol. The server-selected simulated outcome
 * is authoritative; this button must not claim to change a provider result.
 */
export function DummyPayComponent({ amount, onComplete }: PaymentGatewayPayProps) {
  const [processing, setProcessing] = useState(false);

  const confirm = () => {
    setProcessing(true);
    // Keep the interaction async so consumers behave like a real provider.
    queueMicrotask(() => {
      setProcessing(false);
      onComplete("processing");
    });
  };

  return (
    <div className="space-y-4" data-testid="form-dummy-pay">
      <p className="text-sm text-muted-foreground">
        Test gateway — no real payment details or charges are used.
      </p>
      <Button type="button" onClick={confirm} disabled={processing} data-testid="button-confirm-dummy-pay">
        {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Pay {amount}
      </Button>
    </div>
  );
}

export default DummyPayComponent;