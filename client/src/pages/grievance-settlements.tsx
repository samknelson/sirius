import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { GrievanceLayout } from "@/components/layouts/GrievanceLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";

interface Settlement {
  id: string;
  grievanceId: string;
  description: string | null;
  amount: string | null;
}

function formatAmount(amount: string | null): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (Number.isNaN(n)) return amount;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function SettlementsContent() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const settlementsKey = ["/api/grievances", id, "settlements"];

  const {
    data: settlements = [],
    isLoading,
    isError,
  } = useQuery<Settlement[]>({
    queryKey: settlementsKey,
    enabled: !!id,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmount, setEditAmount] = useState("");

  const [newDescription, setNewDescription] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Settlement | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: settlementsKey });

  const createMutation = useMutation({
    mutationFn: async (data: { description: string; amount: string }) =>
      apiRequest("POST", `/api/grievances/${id}/settlements`, {
        description: data.description,
        amount: data.amount,
      }),
    onSuccess: () => {
      invalidate();
      setNewDescription("");
      setNewAmount("");
      toast({ title: "Settlement added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add settlement", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { settlementId: string; description: string; amount: string }) =>
      apiRequest("PATCH", `/api/grievances/${id}/settlements/${data.settlementId}`, {
        description: data.description,
        amount: data.amount,
      }),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      toast({ title: "Settlement updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update settlement", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (settlementId: string) =>
      apiRequest("DELETE", `/api/grievances/${id}/settlements/${settlementId}`),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast({ title: "Settlement removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove settlement", description: error.message, variant: "destructive" });
    },
  });

  function startEdit(s: Settlement) {
    setEditingId(s.id);
    setEditDescription(s.description ?? "");
    setEditAmount(s.amount ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  const canAdd = newDescription.trim() !== "" || newAmount.trim() !== "";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Settlement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 items-start">
            <Textarea
              placeholder="Description"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              data-testid="input-new-settlement-description"
            />
            <Input
              placeholder="Amount"
              inputMode="decimal"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              data-testid="input-new-settlement-amount"
            />
            <Button
              onClick={() =>
                createMutation.mutate({
                  description: newDescription.trim(),
                  amount: newAmount.trim(),
                })
              }
              disabled={!canAdd || createMutation.isPending}
              data-testid="button-add-settlement"
            >
              <Plus size={16} className="mr-2" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlements</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isError ? (
            <p className="text-destructive" data-testid="text-settlements-error">
              Failed to load settlements.
            </p>
          ) : settlements.length === 0 ? (
            <p className="text-muted-foreground" data-testid="text-no-settlements">
              No settlements recorded.
            </p>
          ) : (
            <div className="space-y-2" data-testid="list-settlements">
              {settlements.map((s) => {
                const isEditing = editingId === s.id;
                return (
                  <div
                    key={s.id}
                    className="border rounded-lg px-4 py-3"
                    data-testid={`row-settlement-${s.id}`}
                  >
                    {isEditing ? (
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 items-start">
                        <Textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description"
                          data-testid={`input-edit-settlement-description-${s.id}`}
                        />
                        <Input
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          placeholder="Amount"
                          inputMode="decimal"
                          data-testid={`input-edit-settlement-amount-${s.id}`}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              updateMutation.mutate({
                                settlementId: s.id,
                                description: editDescription.trim(),
                                amount: editAmount.trim(),
                              })
                            }
                            disabled={
                              updateMutation.isPending ||
                              (editDescription.trim() === "" && editAmount.trim() === "")
                            }
                            data-testid={`button-save-settlement-${s.id}`}
                          >
                            <Check size={16} />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEdit}
                            data-testid={`button-cancel-settlement-${s.id}`}
                          >
                            <X size={16} />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p
                            className="text-foreground whitespace-pre-wrap break-words"
                            data-testid={`text-settlement-description-${s.id}`}
                          >
                            {s.description || "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className="text-foreground font-medium tabular-nums"
                            data-testid={`text-settlement-amount-${s.id}`}
                          >
                            {formatAmount(s.amount)}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(s)}
                            data-testid={`button-edit-settlement-${s.id}`}
                          >
                            <Pencil size={16} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(s)}
                            data-testid={`button-delete-settlement-${s.id}`}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove settlement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this settlement from the grievance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-settlement">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
              data-testid="button-confirm-delete-settlement"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function GrievanceSettlements() {
  return (
    <GrievanceLayout activeTab="settlements">
      <SettlementsContent />
    </GrievanceLayout>
  );
}
