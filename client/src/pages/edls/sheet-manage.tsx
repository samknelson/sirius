import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Settings, Check, AlertCircle, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { EdlsSheetStatus } from "@shared/schema";

const statusOptions: { value: EdlsSheetStatus; label: string; description: string }[] = [
  { value: "draft", label: "Draft", description: "Sheet is in draft mode and can be freely edited" },
  { value: "request", label: "Requested", description: "Sheet has been requested for scheduling" },
  { value: "lock", label: "Scheduled", description: "Sheet is locked and scheduled for work" },
  { value: "reserved", label: "Reserved", description: "Sheet is reserved for future use" },
  { value: "trash", label: "Trash", description: "Sheet is marked for deletion" },
];

const statusColors: Record<EdlsSheetStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  request: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  lock: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  trash: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  reserved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

function EdlsSheetManageContent() {
  const { sheet } = useEdlsSheetLayout();
  const { toast } = useToast();
  const sheetId = sheet.id;
  const [selectedStatus, setSelectedStatus] = useState<EdlsSheetStatus | "">("");
  const [showTrashConfirm, setShowTrashConfirm] = useState(false);

  const currentStatus = (sheet.status as EdlsSheetStatus) || "draft";
  const currentStatusOption = statusOptions.find(s => s.value === currentStatus);

  const setStatusMutation = useMutation({
    mutationFn: async (newStatus: EdlsSheetStatus) => {
      const response = await apiRequest("PATCH", `/api/edls/sheets/${sheetId}/status`, { status: newStatus });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheetId] });
      toast({
        title: "Status Updated",
        description: `Sheet status has been changed to ${statusOptions.find(s => s.value === selectedStatus)?.label}`,
      });
      setSelectedStatus("");
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Status",
        description: error?.message || "An error occurred while updating the status",
        variant: "destructive",
      });
    },
  });

  const handleApplyStatus = () => {
    if (selectedStatus && selectedStatus !== currentStatus) {
      if (selectedStatus === "trash") {
        setShowTrashConfirm(true);
      } else {
        setStatusMutation.mutate(selectedStatus);
      }
    }
  };

  const handleConfirmTrash = () => {
    setShowTrashConfirm(false);
    setStatusMutation.mutate("trash");
  };

  const availableStatuses = statusOptions.filter(s => s.value !== currentStatus);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Manage Sheet
          </CardTitle>
          <CardDescription>
            Perform management actions on this sheet
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Current Status</h3>
            <div className="flex items-center gap-3">
              <Badge className={statusColors[currentStatus]} data-testid="badge-current-status">
                {currentStatusOption?.label}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {currentStatusOption?.description}
              </span>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-sm font-medium mb-3">Change Status</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <Select
                  value={selectedStatus}
                  onValueChange={(value) => setSelectedStatus(value as EdlsSheetStatus)}
                >
                  <SelectTrigger data-testid="select-new-status">
                    <SelectValue placeholder="Select new status..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStatuses.map((status) => (
                      <SelectItem 
                        key={status.value} 
                        value={status.value}
                        data-testid={`option-status-${status.value}`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge className={statusColors[status.value]} variant="outline">
                            {status.label}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleApplyStatus}
                disabled={!selectedStatus || setStatusMutation.isPending}
                data-testid="button-apply-status"
              >
                <Check className="h-4 w-4 mr-2" />
                {setStatusMutation.isPending ? "Applying..." : "Apply Status"}
              </Button>
            </div>
            {selectedStatus && (
              <p className="text-sm text-muted-foreground mt-2">
                {statusOptions.find(s => s.value === selectedStatus)?.description}
              </p>
            )}
          </div>

          {setStatusMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to update status. You may not have permission to perform this action.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showTrashConfirm} onOpenChange={setShowTrashConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Move Sheet to Trash?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to move this sheet to trash? All worker assignments for this sheet will be permanently deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-trash">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmTrash}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-trash"
            >
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function EdlsSheetManagePage() {
  return (
    <EdlsSheetLayout activeTab="manage">
      <EdlsSheetManageContent />
    </EdlsSheetLayout>
  );
}
