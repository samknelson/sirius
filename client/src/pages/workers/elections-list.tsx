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
import { ElectionFormDialog } from "@/components/trust/ElectionFormDialog";
import type { WorkerTrustElection } from "@shared/schema";

function ElectionsListContent() {
  const { worker } = useWorkerLayout();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("staff");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery<WorkerTrustElection[]>({
    queryKey: ["/api/workers", worker.id, "trust-elections"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${worker.id}/trust-elections?sort=startDesc`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>All Trust Elections</CardTitle>
          {canEdit && (
            <Button onClick={() => setIsModalOpen(true)} data-testid="button-create-election">
              New Election
            </Button>
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
                <TableHead>Policy</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Benefits</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid={`row-election-${row.id}`}>
                  <TableCell>
                    <Badge variant={row.endYmd ? "secondary" : "default"} data-testid={`badge-status-${row.id}`}>
                      {row.endYmd ? "Ended" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell data-testid={`text-policy-${row.id}`}>{row.policyId}</TableCell>
                  <TableCell data-testid={`text-start-${row.id}`}>{row.startYmd}</TableCell>
                  <TableCell data-testid={`text-end-${row.id}`}>{row.endYmd ?? "—"}</TableCell>
                  <TableCell data-testid={`text-benefits-${row.id}`}>
                    {row.benefitIds && row.benefitIds.length > 0 ? row.benefitIds.length : "—"}
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
              ))}
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
