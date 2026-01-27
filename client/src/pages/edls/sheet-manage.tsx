import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Settings, ChevronDown, Trash2, Lock, Unlock, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface CopySheetResponse {
  newSheetId: string;
  successCount: number;
  failedAssignments: Array<{ workerId: string; workerName: string; reason: string }>;
}

function EdlsSheetManageContent() {
  const { sheet } = useEdlsSheetLayout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const sheetId = sheet.id;
  const [showTrashConfirm, setShowTrashConfirm] = useState(false);
  const [copyTargetDate, setCopyTargetDate] = useState("");

  const currentStatus = (sheet.status as EdlsSheetStatus) || "draft";
  const currentStatusOption = statusOptions.find(s => s.value === currentStatus);
  const sheetData = (sheet.data as Record<string, any>) || {};
  const hasTrashLock = !!sheetData.trashLock;

  const setStatusMutation = useMutation({
    mutationFn: async (newStatus: EdlsSheetStatus) => {
      return apiRequest("PATCH", `/api/edls/sheets/${sheetId}/status`, { status: newStatus });
    },
    onSuccess: (_data, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheetId] });
      const statusLabel = statusOptions.find(s => s.value === newStatus)?.label;
      toast({
        title: "Status Updated",
        description: `Sheet status has been changed to ${statusLabel}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Status",
        description: error?.message || "An error occurred while updating the status",
        variant: "destructive",
      });
    },
  });

  const trashLockMutation = useMutation({
    mutationFn: async (trashLock: boolean) => {
      return apiRequest("PATCH", `/api/edls/sheets/${sheetId}/trash-lock`, { trashLock });
    },
    onSuccess: (_data, trashLock) => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheetId] });
      toast({
        title: trashLock ? "Trash Lock Set" : "Trash Lock Cleared",
        description: trashLock 
          ? "This sheet is now protected from being moved to trash" 
          : "This sheet can now be moved to trash",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Trash Lock",
        description: error?.message || "An error occurred while updating the trash lock",
        variant: "destructive",
      });
    },
  });

  const copySheetMutation = useMutation({
    mutationFn: async (targetDate: string) => {
      return apiRequest("POST", `/api/edls/sheets/${sheetId}/copy`, { targetDate }) as Promise<CopySheetResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets"] });
      
      if (data.failedAssignments.length > 0) {
        const failedNames = data.failedAssignments.map(f => f.workerName).join(", ");
        toast({
          title: "Sheet Copied with Some Failures",
          description: `${data.successCount} assignments copied successfully. Could not copy: ${failedNames}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sheet Copied Successfully",
          description: `Sheet and ${data.successCount} assignments have been copied to the new date`,
        });
      }
      
      setCopyTargetDate("");
      setLocation(`/edls/sheet/${data.newSheetId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Copy Sheet",
        description: error?.message || "An error occurred while copying the sheet",
        variant: "destructive",
      });
    },
  });

  const handleCopySheet = () => {
    if (!copyTargetDate) {
      toast({
        title: "Date Required",
        description: "Please select a target date for the copy",
        variant: "destructive",
      });
      return;
    }
    
    if (copyTargetDate === sheet.ymd) {
      toast({
        title: "Invalid Date",
        description: "Target date must be different from the source sheet date",
        variant: "destructive",
      });
      return;
    }
    
    copySheetMutation.mutate(copyTargetDate);
  };

  const handleStatusAction = (newStatus: EdlsSheetStatus) => {
    if (newStatus === currentStatus) return;
    
    if (newStatus === "trash") {
      setShowTrashConfirm(true);
    } else {
      setStatusMutation.mutate(newStatus);
    }
  };

  const handleConfirmTrash = () => {
    setShowTrashConfirm(false);
    setStatusMutation.mutate("trash");
  };

  const handleTrashLockToggle = () => {
    trashLockMutation.mutate(!hasTrashLock);
  };

  const availableStatuses = statusOptions.filter(s => {
    if (s.value === currentStatus) return false;
    if (s.value === "trash" && hasTrashLock) return false;
    return true;
  });
  const isPending = setStatusMutation.isPending || trashLockMutation.isPending || copySheetMutation.isPending;
  const canEdit = currentStatus !== "lock" && currentStatus !== "trash";

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
              {hasTrashLock && (
                <Badge variant="outline" className="gap-1" data-testid="badge-trash-lock">
                  <Lock className="h-3 w-3" />
                  Trash Lock
                </Badge>
              )}
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-sm font-medium mb-3">Actions</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  disabled={isPending}
                  data-testid="button-actions-menu"
                >
                  {isPending ? "Processing..." : "Select Action"}
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Change Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {availableStatuses.map((status) => (
                  <DropdownMenuItem
                    key={status.value}
                    onClick={() => handleStatusAction(status.value)}
                    className={status.value === "trash" ? "text-destructive focus:text-destructive" : ""}
                    data-testid={`action-status-${status.value}`}
                  >
                    {status.value === "trash" ? (
                      <>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Change status to: {status.label}
                      </>
                    ) : (
                      <>
                        <Badge className={`${statusColors[status.value]} mr-2`} variant="outline">
                          {status.label}
                        </Badge>
                        Change status to: {status.label}
                      </>
                    )}
                  </DropdownMenuItem>
                ))}
                
                {canEdit && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Trash Protection</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {hasTrashLock ? (
                      <DropdownMenuItem
                        onClick={handleTrashLockToggle}
                        data-testid="action-clear-trash-lock"
                      >
                        <Unlock className="mr-2 h-4 w-4" />
                        Clear trash lock
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={handleTrashLockToggle}
                        data-testid="action-set-trash-lock"
                      >
                        <Lock className="mr-2 h-4 w-4" />
                        Set trash lock
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Make a Copy
          </CardTitle>
          <CardDescription>
            Create a copy of this sheet for a different date, including all crews and assignments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="copy-target-date">Target Date</Label>
            <div className="flex items-center gap-3">
              <Input
                id="copy-target-date"
                type="date"
                value={copyTargetDate}
                onChange={(e) => setCopyTargetDate(e.target.value)}
                className="w-48"
                data-testid="input-copy-target-date"
              />
              <Button
                onClick={handleCopySheet}
                disabled={copySheetMutation.isPending || !copyTargetDate}
                data-testid="button-copy-sheet"
              >
                {copySheetMutation.isPending ? "Copying..." : "Copy Sheet"}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Current sheet date: {sheet.ymd}
            </p>
            <p className="text-sm text-muted-foreground">
              The new sheet will be created as a draft. If any assignments cannot be copied (e.g., worker already assigned elsewhere on the target date), you will be notified.
            </p>
          </div>
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
