import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { BtuCsgLayout, useBtuCsgLayout } from "@/components/layouts/BtuCsgLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, Loader2, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  in_progress: "default",
  resolved: "outline",
  closed: "outline",
};

function BtuCsgViewContent() {
  const { record } = useBtuCsgLayout();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/sitespecific/btu/csg/${record.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/csg"] });
      toast({
        title: "Record Deleted",
        description: "The grievance record has been deleted.",
      });
      navigate("/sitespecific/btu/csgs");
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error?.message || "Failed to delete record.",
        variant: "destructive",
      });
      setShowDeleteDialog(false);
    },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return "-";
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
          <CardDescription>Information about the person filing the grievance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">BPS ID</label>
              <p className="text-foreground" data-testid="text-bps-id">{record.bpsId || "-"}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Full Name</label>
              <p className="text-foreground" data-testid="text-full-name">
                {[record.firstName, record.lastName].filter(Boolean).join(" ") || "-"}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Phone</label>
              <p className="text-foreground" data-testid="text-phone">{record.phone || "-"}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Non-BPS Email</label>
              <p className="text-foreground" data-testid="text-email">{record.nonBpsEmail || "-"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>School Information</CardTitle>
          <CardDescription>Details about the school and class</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">School</label>
              <p className="text-foreground" data-testid="text-school">{record.school || "-"}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Principal/Headmaster</label>
              <p className="text-foreground" data-testid="text-principal">{record.principalHeadmaster || "-"}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Role</label>
              <p className="text-foreground" data-testid="text-role">{record.role || "-"}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Type of Class</label>
              <p className="text-foreground" data-testid="text-class-type">{record.typeOfClass || "-"}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Course</label>
              <p className="text-foreground" data-testid="text-course">{record.course || "-"}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Section</label>
              <p className="text-foreground" data-testid="text-section">{record.section || "-"}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Number of Students</label>
              <p className="text-foreground" data-testid="text-students">{record.numberOfStudents || "-"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grievance Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Comments</label>
              <p className="text-foreground whitespace-pre-wrap" data-testid="text-comments">
                {record.comments || "-"}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div>
                <Badge variant={STATUS_COLORS[record.status] || "secondary"} data-testid="badge-status">
                  {record.status.replace("_", " ")}
                </Badge>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Admin Notes</label>
              <p className="text-foreground whitespace-pre-wrap" data-testid="text-admin-notes">
                {record.adminNotes || "-"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Record Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Record ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-record-id">{record.id}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Created At</label>
              <p className="text-foreground" data-testid="text-created-at">{formatDate(record.createdAt)}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Updated At</label>
              <p className="text-foreground" data-testid="text-updated-at">{formatDate(record.updatedAt)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="pt-4 border-t border-border">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Link href="/sitespecific/btu/csgs">
            <Button variant="outline" data-testid="button-back-to-list">
              Back to List
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Link href={`/sitespecific/btu/csg/${record.id}/edit`}>
              <Button variant="default" data-testid="button-edit">
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </Link>
            <Button 
              variant="destructive" 
              onClick={() => setShowDeleteDialog(true)}
              data-testid="button-delete"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Grievance Record</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this grievance record? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BtuCsgViewPage() {
  return (
    <BtuCsgLayout activeTab="view">
      <BtuCsgViewContent />
    </BtuCsgLayout>
  );
}
