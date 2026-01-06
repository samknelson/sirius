import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, Info, Save } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface PaymentTypesResponse {
  paymentTypes: string[];
}

const AVAILABLE_PAYMENT_TYPES = [
  { id: 'card', name: 'Credit/Debit Card', description: 'Accept Visa, Mastercard, Amex, and other cards' },
  { id: 'us_bank_account', name: 'US Bank Account (ACH)', description: 'ACH direct debit payments' },
  { id: 'cashapp', name: 'Cash App Pay', description: 'Accept payments via Cash App' },
  { id: 'paypal', name: 'PayPal', description: 'Accept payments via PayPal' },
  { id: 'link', name: 'Link', description: 'Stripe\'s one-click payment method' },
  { id: 'affirm', name: 'Affirm', description: 'Buy now, pay later with Affirm' },
  { id: 'afterpay_clearpay', name: 'Afterpay / Clearpay', description: 'Buy now, pay later' },
  { id: 'klarna', name: 'Klarna', description: 'Buy now, pay later with Klarna' },
  { id: 'alipay', name: 'Alipay', description: 'Popular payment method in China' },
  { id: 'wechat_pay', name: 'WeChat Pay', description: 'Popular payment method in China' },
  { id: 'ideal', name: 'iDEAL', description: 'Popular payment method in Netherlands' },
  { id: 'sepa_debit', name: 'SEPA Direct Debit', description: 'European bank debits' },
  { id: 'bancontact', name: 'Bancontact', description: 'Popular payment method in Belgium' },
  { id: 'giropay', name: 'Giropay', description: 'Popular payment method in Germany' },
  { id: 'eps', name: 'EPS', description: 'Popular payment method in Austria' },
  { id: 'p24', name: 'Przelewy24', description: 'Popular payment method in Poland' },
  { id: 'blik', name: 'BLIK', description: 'Mobile payment method in Poland' },
  { id: 'acss_debit', name: 'ACSS Debit', description: 'Pre-authorized debit in Canada' },
  { id: 'au_becs_debit', name: 'BECS Direct Debit', description: 'Direct debit in Australia' },
  { id: 'bacs_debit', name: 'Bacs Direct Debit', description: 'Direct debit in UK' },
  { id: 'fpx', name: 'FPX', description: 'Online banking in Malaysia' },
  { id: 'grabpay', name: 'GrabPay', description: 'Popular digital wallet in Southeast Asia' },
  { id: 'paynow', name: 'PayNow', description: 'Real-time payment in Singapore' },
  { id: 'promptpay', name: 'PromptPay', description: 'Real-time payment in Thailand' },
  { id: 'pix', name: 'Pix', description: 'Instant payment method in Brazil' },
  { id: 'boleto', name: 'Boleto', description: 'Cash-based voucher payment in Brazil' },
  { id: 'oxxo', name: 'OXXO', description: 'Cash-based voucher payment in Mexico' },
  { id: 'konbini', name: 'Konbini', description: 'Cash payment at convenience stores in Japan' },
  { id: 'customer_balance', name: 'Customer Balance', description: 'Use customer account balance' },
  { id: 'sofort', name: 'Sofort', description: 'Bank redirect in Europe (deprecated, use Klarna)' },
];

export default function PaymentTypesPage() {
  usePageTitle("Payment Types");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isInitialized = useRef(false);

  const { data, isLoading } = useQuery<PaymentTypesResponse>({
    queryKey: ["/api/ledger/stripe/payment-types"],
  });

  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  useEffect(() => {
    if (!isInitialized.current && data?.paymentTypes) {
      setSelectedTypes(data.paymentTypes);
      isInitialized.current = true;
    }
  }, [data]);

  const updatePaymentTypesMutation = useMutation({
    mutationFn: async (paymentTypes: string[]) => {
      return apiRequest("PUT", "/api/ledger/stripe/payment-types", { paymentTypes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/stripe/payment-types"] });
      toast({
        title: "Payment Methods Updated",
        description: "Stripe payment methods have been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update payment methods.",
        variant: "destructive",
      });
    },
  });

  const handleToggle = (typeId: string, checked: boolean) => {
    setSelectedTypes(prev => {
      if (checked) {
        return [...prev, typeId];
      } else {
        return prev.filter(t => t !== typeId);
      }
    });
  };

  const handleSave = () => {
    if (selectedTypes.length === 0) {
      toast({
        title: "Selection Required",
        description: "Please select at least one payment method.",
        variant: "destructive",
      });
      return;
    }
    updatePaymentTypesMutation.mutate(selectedTypes);
  };

  const hasChanges = JSON.stringify([...selectedTypes].sort()) !== JSON.stringify([...(data?.paymentTypes || [])].sort());

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Stripe Payment Methods
          </h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Stripe Payment Methods
          </h1>
          <p className="text-muted-foreground mt-2">
            Select which payment methods you want to accept through Stripe
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updatePaymentTypesMutation.isPending}
          data-testid="button-save-payment-types"
        >
          <Save className="h-4 w-4 mr-2" />
          {updatePaymentTypesMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Not all payment methods are available in all countries or for all Stripe accounts. 
          Some methods may require additional setup in your Stripe Dashboard.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <CreditCard className="h-5 w-5 mr-2" />
            Available Payment Methods
          </CardTitle>
          <CardDescription>
            Select the payment methods you want to enable for your application
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {AVAILABLE_PAYMENT_TYPES.map((type) => (
              <div
                key={type.id}
                className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                <Checkbox
                  id={type.id}
                  checked={selectedTypes.includes(type.id)}
                  onCheckedChange={(checked) => handleToggle(type.id, checked as boolean)}
                  data-testid={`checkbox-payment-type-${type.id}`}
                />
                <div className="flex-1">
                  <Label
                    htmlFor={type.id}
                    className="font-medium cursor-pointer"
                  >
                    {type.name}
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {type.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {hasChanges && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            You have unsaved changes. Click "Save Changes" to apply your selections.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
