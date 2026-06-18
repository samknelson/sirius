import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PaymentGatewayAddProps } from "../registry";

/** Luhn checksum validation for a string of digits. */
function isLuhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Best-effort card-brand detection from the leading digits (BIN ranges). */
function detectBrand(digits: string): string {
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(6011|65|64[4-9])/.test(digits)) return "discover";
  if (/^3(0[0-5]|[68])/.test(digits)) return "diners";
  if (/^35/.test(digits)) return "jcb";
  return "card";
}

/** Group digits into 4-character blocks for display. */
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Dummy gateway "add a payment method" form, auto-discovered by the client
 * payment-gateway registry (id `dummy:DummyAddPaymentMethod`). It collects a
 * hand-typed test card, validates the number client-side with the Luhn
 * algorithm, then builds an opaque method token carrying ONLY the brand,
 * expiry, and last 4 digits (plus a random nonce) — the full PAN and the CVC
 * never leave this component and are never sent to the server. The provider
 * `clientSecret`/`publicConfig` are unused (there is no remote provider).
 */
export function DummyAddPaymentMethod({
  onSuccess,
  onCancel,
}: PaymentGatewayAddProps) {
  const { toast } = useToast();
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const digits = cardNumber.replace(/\D/g, "");
    if (digits.length < 12 || digits.length > 19 || !isLuhnValid(digits)) {
      toast({
        title: "Invalid card number",
        description: "Please enter a valid card number.",
        variant: "destructive",
      });
      return;
    }

    const expMatch = expiry.match(/^\s*(\d{1,2})\s*\/\s*(\d{2,4})\s*$/);
    if (!expMatch) {
      toast({
        title: "Invalid expiry",
        description: "Enter the expiry as MM/YY.",
        variant: "destructive",
      });
      return;
    }
    const expMonth = parseInt(expMatch[1], 10);
    let expYear = parseInt(expMatch[2], 10);
    if (expYear < 100) expYear += 2000;
    if (expMonth < 1 || expMonth > 12) {
      toast({
        title: "Invalid expiry",
        description: "The expiry month must be between 01 and 12.",
        variant: "destructive",
      });
      return;
    }

    if (!/^\d{3,4}$/.test(cvc)) {
      toast({
        title: "Invalid security code",
        description: "Enter the 3- or 4-digit security code.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    // Build the opaque token from non-sensitive, strictly-bounded fields ONLY.
    // The full card number and the CVC are intentionally excluded — they are
    // discarded here and never leave the browser.
    const meta = {
      brand: detectBrand(digits),
      last4: digits.slice(-4),
      expMonth,
      expYear,
    };
    const methodToken = "dummy_pm_" + btoa(JSON.stringify(meta));
    onSuccess(methodToken);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Alert>
        <AlertDescription>
          This is a test gateway. No real charges are made and only the card
          brand, expiry, and last 4 digits are stored.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="dummy-card-number">Card number</Label>
        <Input
          id="dummy-card-number"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4242 4242 4242 4242"
          value={cardNumber}
          onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
          disabled={isProcessing}
          data-testid="input-dummy-card-number"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="dummy-card-expiry">Expiry (MM/YY)</Label>
          <Input
            id="dummy-card-expiry"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="12/29"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            disabled={isProcessing}
            data-testid="input-dummy-card-expiry"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dummy-card-cvc">Security code</Label>
          <Input
            id="dummy-card-cvc"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
            disabled={isProcessing}
            data-testid="input-dummy-card-cvc"
          />
        </div>
      </div>

      <div className="flex justify-end space-x-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isProcessing}
          data-testid="button-cancel-dummy-payment-method"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isProcessing}
          data-testid="button-confirm-payment-method"
        >
          {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add Payment Method
        </Button>
      </div>
    </form>
  );
}

export default DummyAddPaymentMethod;
