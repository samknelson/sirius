import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface GrievanceListItem {
  id: string;
  statusId: string | null;
  categoryId: string;
  statusName: string | null;
  categoryName: string | null;
  workerCount: number;
  employerCount: number;
}

function EmployerGrievancesContent() {
  const { employer } = useEmployerLayout();

  const { data: grievances = [], isLoading } = useQuery<GrievanceListItem[]>({
    queryKey: ["/api/grievances", { employerId: employer.id }],
  });

  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : grievances.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="text-no-grievances">
            No grievances found for this employer.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Workers</TableHead>
                <TableHead className="text-center">Employers</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grievances.map((g) => (
                <TableRow key={g.id} data-testid={`row-grievance-${g.id}`}>
                  <TableCell className="font-medium" data-testid={`text-grievance-category-${g.id}`}>
                    {g.categoryName || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" data-testid={`badge-grievance-status-${g.id}`}>
                      {g.statusName || "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center" data-testid={`text-grievance-worker-count-${g.id}`}>
                    {g.workerCount}
                  </TableCell>
                  <TableCell className="text-center" data-testid={`text-grievance-employer-count-${g.id}`}>
                    {g.employerCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/grievance/${g.id}`}>
                      <Button variant="ghost" size="sm" data-testid={`button-view-grievance-${g.id}`}>
                        View
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function EmployerGrievances() {
  return (
    <EmployerLayout activeTab="grievances">
      <EmployerGrievancesContent />
    </EmployerLayout>
  );
}
