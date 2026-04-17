import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PaymentBatchLayout, usePaymentBatchLayout } from "@/components/layouts/PaymentBatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

function BatchEditContent() {
  const { batch } = usePaymentBatchLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");

  useEffect(() => {
    if (batch) {
      setName(batch.name);
    }
  }, [batch]);

  const updateMutation = useMutation({
    mutationFn: (data: { name: string }) =>
      apiRequest("PATCH", `/api/ledger-payment-batches/${batch.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-payment-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-payment-batches", batch.id] });
      toast({ title: "Batch updated", description: "The payment batch has been updated." });
      setLocation(`/ledger/payment-batch/${batch.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update batch", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ name: name.trim() });
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
