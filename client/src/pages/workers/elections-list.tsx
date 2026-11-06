import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import { EnrollmentLaunchers } from "@/components/trust/EnrollmentLaunchers";
import { ElectionFormDialog } from "@/components/trust/ElectionFormDialog";
import type { WorkerTrustElectionView } from "@shared/schema";
import { getDateRangeStatus } from "@shared/utils";

const electionStatusPresentation = {
  upcoming: { label: "Upcoming", variant: "outline" as const },
  active: { label: "Active", variant: "default" as const },
  ended: { label: "Ended", variant: "secondary" as const },
};

function ElectionsListContent() {
  const { worker } = useWorkerLayout();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("staff");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery<WorkerTrustElectionView[]>({
    queryKey: ["/api/workers", worker.id, "trust-elections"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${worker.id}/trust-elections?sort=startDesc`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
  const latestElection = rows[0] ?? null;


  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <CardTitle>All Trust Elections</CardTitle>
          <EnrollmentLaunchers workerId={worker.id} />
          {canEdit && (
            <div className="flex gap-2">
              <Button
                onClick={() => setIsModalOpen(true)}
                disabled={isLoading}
                data-testid="button-create-election"
              >
                New Election
              </Button>
            </div>
          )}
        </div>
        <CardDescription>Every trust election for this worker, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground" data-testid="text-no-elections">
            No trust elections recorded.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Benefits</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const status = electionStatusPresentation[
                  getDateRangeStatus(row.startYmd, row.endYmd)
                ];
                return (
                <TableRow key={row.id} data-testid={`row-election-${row.id}`}>
                  <TableCell>
                    <Badge variant={status.variant} data-testid={`badge-status-${row.id}`}>
                      {status.label}
                    </Badge>
                  </TableCell>
                  <TableCell data-testid={`text-employer-${row.id}`}>{row.employerName ?? "Unknown employer"}</TableCell>
                  <TableCell data-testid={`text-policy-${row.id}`}>{row.policyName ?? "Unknown policy"}</TableCell>
                  <TableCell data-testid={`text-start-${row.id}`}>{row.startYmd}</TableCell>
                  <TableCell data-testid={`text-end-${row.id}`}>{row.endYmd ?? "—"}</TableCell>
                  <TableCell data-testid={`text-benefits-${row.id}`} title={row.benefits?.map((b) => b.name).join(", ")}>
                    {row.benefits && row.benefits.length > 0
                      ? row.benefits.map((b) => b.name).join(", ")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/trust/election/${row.id}`}
                      className="text-primary underline-offset-2 hover:underline text-sm"
                      data-testid={`link-detail-${row.id}`}
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
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

export default function ElectionsListPage() {
  return (
    <WorkerLayout activeTab="elections-list">
      <ElectionsListContent />
    </WorkerLayout>
  );
}
