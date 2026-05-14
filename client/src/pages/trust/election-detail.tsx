import { useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import type { WorkerTrustElection } from "@shared/schema";

export default function ElectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<"view" | "edit">("view");

  const { data: election, isLoading, isError } = useQuery<WorkerTrustElection>({
    queryKey: ["/api/trust-elections", id],
    queryFn: async () => {
      const res = await fetch(`/api/trust-elections/${id}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/trust-elections/${id}`),
    onSuccess: () => {
      toast({ title: "Election deleted" });
      if (election) {
        queryClient.invalidateQueries({ queryKey: ["/api/workers", election.workerId, "trust-elections"] });
      }
    },
    onError: () => toast({ title: "Error", description: "Failed to delete", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !election) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Trust election not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <header className="bg-card border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link href={`/workers/${election.workerId}/elections/list`}>
              <Button variant="ghost" size="sm" data-testid="button-back">
                <ArrowLeft size={16} className="mr-2" />
                Back to worker elections
              </Button>
            </Link>
          </div>
          <Badge variant={election.endYmd ? "secondary" : "default"} data-testid="badge-election-status">
            {election.endYmd ? "Ended" : "Active"}
          </Badge>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
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
            <Tabs value={tab} onValueChange={(v) => setTab(v as "view" | "edit")}>
              <TabsList>
                <TabsTrigger value="view" data-testid="tab-view">View</TabsTrigger>
                <TabsTrigger value="edit" data-testid="tab-edit">Edit</TabsTrigger>
              </TabsList>

              <TabsContent value="view" className="pt-4">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Policy</dt>
                    <dd data-testid="text-policy">{election.policyId}</dd>
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
                      {election.benefitIds && election.benefitIds.length > 0
                        ? election.benefitIds.join(", ")
                        : "—"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Covered relationships</dt>
                    <dd data-testid="text-relationships">
                      {election.relationshipIds && election.relationshipIds.length > 0
                        ? election.relationshipIds.join(", ")
                        : "—"}
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
              </TabsContent>

              <TabsContent value="edit" className="pt-4">
                <p className="text-sm text-muted-foreground mb-4">
                  Click below to open the edit form. The worker cannot be changed.
                </p>
                <Button onClick={() => setEditOpen(true)} data-testid="button-open-edit-tab">
                  Edit Election
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>

      <ElectionFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        workerId={election.workerId}
        election={election}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/trust-elections", id] });
        }}
      />
    </div>
  );
}
