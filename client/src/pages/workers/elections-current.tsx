import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import { EnrollmentLaunchers } from "@/components/trust/EnrollmentLaunchers";
import { ElectionFormDialog } from "@/components/trust/ElectionFormDialog";
import { formatYmd } from "@shared/utils";
import type { WorkerTrustElectionView } from "@shared/schema";

function ElectionsCurrentContent() {
  const { worker } = useWorkerLayout();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("staff");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: current, isLoading } = useQuery<WorkerTrustElectionView | null>({
    queryKey: ["/api/workers", worker.id, "trust-elections", "current"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${worker.id}/trust-elections/current`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: rows = [], isLoading: isLatestElectionLoading } = useQuery<WorkerTrustElectionView[]>({
    queryKey: ["/api/workers", worker.id, "trust-elections"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${worker.id}/trust-elections?sort=startDesc`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
  const latestElection = rows[0] ?? null;


  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <CardTitle>Current Trust Election</CardTitle>
          <EnrollmentLaunchers workerId={worker.id} />
          {canEdit && (
            <div className="flex gap-2">
              <Button
                onClick={() => setIsModalOpen(true)}
                disabled={isLatestElectionLoading}
                data-testid="button-create-election"
              >
                New Election
              </Button>
            </div>
          )}
        </div>
        <CardDescription>
          The worker's trust election whose coverage includes today. Creating a new election will end-date an open one automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {current ? (
          <div className="space-y-3" data-testid="card-current-election">
            <div className="flex items-center gap-2">
              <Badge variant="default">Active</Badge>
              {canEdit && (
                <Link
                  href={`/trust/election/${current.id}`}
                  className="text-primary underline-offset-2 hover:underline"
                  data-testid="link-current-election-detail"
                >
                  View detail
                </Link>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Employer</dt>
                <dd data-testid="text-current-employer">{current.employerName ?? "Unknown employer"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Policy</dt>
                <dd data-testid="text-current-policy">{current.policyName ?? "Unknown policy"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date</dt>
                <dd data-testid="text-current-date">
                  {formatYmd(current.startYmd)} – {current.endYmd ? formatYmd(current.endYmd) : "ongoing"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Benefits</dt>
                <dd data-testid="text-current-benefits">
                  {current.benefits && current.benefits.length > 0
                    ? current.benefits.map((b) => b.name).join(", ")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Relationships</dt>
                <dd data-testid="text-current-relationships">
                  {current.relationships && current.relationships.length > 0
                    ? current.relationships.map((relation, i) => (
                        <span key={relation.id}>
                          {i > 0 && ", "}
                          {relation.coveredWorkerId ? (
                            <Link
                              href={`/workers/${relation.coveredWorkerId}`}
                              className="text-primary underline-offset-2 hover:underline focus-visible:underline"
                            >
                              {relation.label}
                            </Link>
                          ) : relation.label}
                        </span>
                      ))
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground" data-testid="text-no-current-election">
            No current election for this worker.
          </div>
        )}
      </CardContent>

      {canEdit && (
        <ElectionFormDialog
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          mode="create"
          workerId={worker.id}
          createDefaults={latestElection}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "trust-elections"] });
          }}
        />
      )}
    </Card>
  );
}

export default function ElectionsCurrentPage() {
  return (
    <WorkerLayout activeTab="elections-current">
      <ElectionsCurrentContent />
    </WorkerLayout>
  );
}
