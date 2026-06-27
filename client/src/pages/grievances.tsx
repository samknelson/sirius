import { useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { PageHeader } from "@/components/layout/PageHeader";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GrievanceListItem {
  id: string;
  complaint: string | null;
  remedy: string | null;
  statusId: string;
  categoryId: string;
  statusName: string | null;
  categoryName: string | null;
  workerCount: number;
  employerCount: number;
}

export default function Grievances() {
  const [location] = useLocation();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<GrievanceListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: grievances = [], isLoading } = useQuery<GrievanceListItem[]>({
    queryKey: ["/api/grievances"],
  });

  const tabs = [
    { id: "list", label: "List", href: "/grievances" },
    { id: "add", label: "Add", href: "/grievances/add" },
  ];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await apiRequest("DELETE", `/api/grievances/${deleteTarget.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
      toast({ title: "Grievance deleted" });
      setDeleteTarget(null);
    } catch (error: any) {
      toast({
        title: "Failed to delete grievance",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="Grievances"
        icon={<FileText className="text-primary-foreground" size={16} />}
      />

      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => (
              <Link key={tab.id} href={tab.href}>
                <Button
                  variant={location === tab.href ? "default" : "outline"}
                  size="sm"
                  data-testid={`button-grievances-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-end mb-4">
          <Link href="/grievances/add">
            <Button data-testid="button-add-grievance">
              <Plus size={16} className="mr-2" />
              Add Grievance
            </Button>
          </Link>
        </div>

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
                No grievances found.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Complaint</TableHead>
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
                      <TableCell className="max-w-md truncate" data-testid={`text-grievance-complaint-${g.id}`}>
                        {g.complaint || "—"}
                      </TableCell>
                      <TableCell className="text-center" data-testid={`text-grievance-worker-count-${g.id}`}>
                        {g.workerCount}
                      </TableCell>
                      <TableCell className="text-center" data-testid={`text-grievance-employer-count-${g.id}`}>
                        {g.employerCount}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Link href={`/grievance/${g.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`button-view-grievance-${g.id}`}>
                            View
                          </Button>
                        </Link>
                        <Link href={`/grievance/${g.id}/edit`}>
                          <Button variant="ghost" size="sm" data-testid={`button-edit-grievance-${g.id}`}>
                            Edit
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(g)}
                          data-testid={`button-delete-grievance-${g.id}`}
                        >
                          <Trash2 size={16} className="text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this grievance?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the grievance and all of its worker and employer links.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isDeleting}
              data-testid="button-confirm-delete"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
