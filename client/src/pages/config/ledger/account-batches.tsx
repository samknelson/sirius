import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { LedgerAccountLayout, useLedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Search, Package, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { LedgerPaymentBatch } from "@shared/schema/ledger/payment-batch/schema";

function AccountBatchesContent() {
  const { account } = useLedgerAccountLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nameFilter, setNameFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");

  const { data: batches, isLoading } = useQuery<LedgerPaymentBatch[]>({
    queryKey: ["/api/ledger-payment-batches", { accountId: account.id }],
    queryFn: async () => {
      const res = await fetch(`/api/ledger-payment-batches?accountId=${account.id}`);
      if (!res.ok) throw new Error("Failed to fetch batches");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/ledger-payment-batches", {
        name,
        accountId: account.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-payment-batches"] });
      toast({ title: "Batch created", description: "The payment batch has been created." });
      setShowCreate(false);
      setNewBatchName("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create batch", description: error.message, variant: "destructive" });
    },
  });

  const filtered = batches?.filter((b) =>
    nameFilter ? b.name.toLowerCase().includes(nameFilter.toLowerCase()) : true
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold" data-testid="heading-batches">Payment Batches</h2>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-batch">
              <Plus className="h-4 w-4 mr-2" />
              New Batch
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Payment Batch</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newBatchName.trim()) {
                  createMutation.mutate(newBatchName.trim());
                }
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="batchName">Batch Name</Label>
                <Input
                  id="batchName"
                  value={newBatchName}
                  onChange={(e) => setNewBatchName(e.target.value)}
                  placeholder="Enter batch name"
                  data-testid="input-new-batch-name"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreate(false)}
                  data-testid="button-cancel-create"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!newBatchName.trim() || createMutation.isPending}
                  data-testid="button-submit-create"
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by name..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          className="pl-9"
          data-testid="input-filter-batches"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filtered && filtered.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <table className="w-full" data-testid="table-batches">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">ID</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((batch) => (
                  <tr key={batch.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/ledger/payment-batch/${batch.id}`}
                        className="text-primary hover:underline font-medium"
                        data-testid={`link-batch-${batch.id}`}
                      >
                        {batch.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-mono">
                      {batch.id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Package className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-no-batches">No Batches Found</h3>
            <p className="text-muted-foreground text-center">
              {nameFilter ? "No batches match your filter." : "No payment batches have been created for this account yet."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function AccountBatchesPage() {
  return (
    <LedgerAccountLayout activeTab="batches">
      <AccountBatchesContent />
    </LedgerAccountLayout>
  );
}
