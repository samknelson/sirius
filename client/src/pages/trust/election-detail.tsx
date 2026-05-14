import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ElectionFormDialog } from "@/components/trust/ElectionFormDialog";
import {
  TrustElectionLayout,
  useTrustElectionLayout,
} from "@/components/layouts/TrustElectionLayout";

function ElectionDetailsContent() {
  const { election } = useTrustElectionLayout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [editOpen, setEditOpen] = useState(false);

  const policyName = election.policyName ?? "Unknown policy";
  const benefitLabels = (election.benefits ?? []).map((b) => b.name);
  const relationLabels = (election.relationships ?? []).map((r) => r.label);

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/trust-elections/${election.id}`),
    onSuccess: () => {
      toast({ title: "Election deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/workers", election.workerId, "trust-elections"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/workers", election.workerId, "trust-elections", "current"],
      });
      setLocation(`/workers/${election.workerId}/elections/list`);
    },
    onError: () => toast({ title: "Error", description: "Failed to delete", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trust Election</CardTitle>
        <CardDescription>
          Worker:{" "}
          <Link
            href={`/workers/${election.workerId}`}
            className="text-primary underline-offset-2 hover:underline"
            data-testid="link-worker"
          >
            {election.workerId}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Policy</dt>
            <dd data-testid="text-policy">{policyName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Start</dt>
            <dd data-testid="text-start">{election.startYmd}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">End</dt>
            <dd data-testid="text-end">{election.endYmd ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Benefits</dt>
            <dd data-testid="text-benefits">
              {benefitLabels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {benefitLabels.map((label, i) => (
                    <Badge key={i} variant="secondary" data-testid={`chip-benefit-${i}`}>
                      {label}
                    </Badge>
                  ))}
                </div>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Covered relationships</dt>
            <dd data-testid="text-relationships">
              {relationLabels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {relationLabels.map((label, i) => (
                    <Badge key={i} variant="secondary" data-testid={`chip-relation-${i}`}>
                      {label}
                    </Badge>
                  ))}
                </div>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex items-center gap-2">
          <Button onClick={() => setEditOpen(true)} data-testid="button-open-edit">
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" data-testid="button-delete">
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete election?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the election. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  data-testid="button-confirm-delete"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>

      <ElectionFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        workerId={election.workerId}
        election={election}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/trust-elections", election.id] });
        }}
      />
    </Card>
  );
}

export default function ElectionDetailPage() {
  return (
    <TrustElectionLayout activeTab="details">
      <ElectionDetailsContent />
    </TrustElectionLayout>
  );
}
