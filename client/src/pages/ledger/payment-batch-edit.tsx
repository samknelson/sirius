import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PaymentBatchLayout, usePaymentBatchLayout } from "@/components/layouts/PaymentBatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { EntityFileManager } from "@/components/entity-files/EntityFileManager";

function BatchEditContent() {
  const { batch } = usePaymentBatchLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [name, setName] = useState("");
  const [batchTotal, setBatchTotal] = useState("");
  const [expectedPaymentCount, setExpectedPaymentCount] = useState("");

  useEffect(() => {
    if (batch) {
      setName(batch.name);
      setBatchTotal(batch.batchTotal ?? "");
      setExpectedPaymentCount(
        batch.expectedPaymentCount != null ? String(batch.expectedPaymentCount) : "",
      );
    }
  }, [batch]);

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/ledger-payment-batches/${batch.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-payment-batches"] });
      queryClient.invalidateQueries({ queryKey: [`/api/ledger-payment-batches/${batch.id}`] });
      toast({ title: "Batch updated", description: "The payment batch has been updated." });
      setLocation(`/ledger/payment-batch/${batch.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update batch", description: getApiErrorMessage(error, "An unexpected error occurred"), variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      batchTotal: batchTotal.trim() === "" ? null : batchTotal.trim(),
      expectedPaymentCount:
        expectedPaymentCount.trim() === "" ? null : parseInt(expectedPaymentCount, 10),
    };
    updateMutation.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-batch-edit">
        <CardHeader>
          <CardTitle>Edit Payment Batch</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-batch-name"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="batchTotal">Batch Total (optional)</Label>
                <Input
                  id="batchTotal"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={batchTotal}
                  onChange={(e) => setBatchTotal(e.target.value)}
                  data-testid="input-batch-total"
                />
                <p className="text-xs text-muted-foreground">
                  Used to reconcile against the sum of payments in this batch.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expectedPaymentCount">Expected Payments (optional)</Label>
                <Input
                  id="expectedPaymentCount"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={expectedPaymentCount}
                  onChange={(e) => setExpectedPaymentCount(e.target.value)}
                  data-testid="input-expected-count"
                />
                <p className="text-xs text-muted-foreground">
                  How many individual payments you expect to record.
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={updateMutation.isPending || !name.trim()}
                data-testid="button-batch-save"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/ledger/payment-batch/${batch.id}`)}
                data-testid="button-batch-cancel-edit"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <EntityFileManager context="ledger_payment_batch" entityId={batch.id} />
    </div>
  );
}

export default function PaymentBatchEditPage() {
  return (
    <PaymentBatchLayout activeTab="edit">
      <BatchEditContent />
    </PaymentBatchLayout>
  );
}
