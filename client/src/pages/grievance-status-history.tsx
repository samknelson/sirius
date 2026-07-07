import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GrievanceTimelineTemplate } from "@shared/schema";

const NONE_VALUE = "__none__";

interface StatusHistoryEntry {
  id: string;
  grievanceId: string;
  statusId: string;
  date: string;
  isCurrent: boolean;
  statusName: string | null;
}

interface StatusOption {
  id: string;
  name: string;
  isActive?: boolean;
}

/** Format a date for a `datetime-local` input (local time, minute precision). */
function toDatetimeLocal(value: string | Date): string {
  return format(new Date(value), "yyyy-MM-dd'T'HH:mm");
}

/**
 * Timeline-template selector. Lives on this (editable) tab; the Timeline tab
 * is view-only and just renders the computed steps.
 */
function TimelineTemplateCard() {
  const { grievance } = useGrievanceLayout();
  const { toast } = useToast();
  const currentValue = grievance.timelineTemplateId ?? NONE_VALUE;
  const [selected, setSelected] = useState<string>(currentValue);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSelected(grievance.timelineTemplateId ?? NONE_VALUE);
  }, [grievance.timelineTemplateId]);

  const { data: templates, isLoading } = useQuery<GrievanceTimelineTemplate[]>({
    queryKey: ["/api/grievance-timeline-templates"],
  });

  const isDirty = selected !== currentValue;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiRequest("PATCH", `/api/grievances/${grievance.id}`, {
        timelineTemplateId: selected === NONE_VALUE ? null : selected,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievance.id] });
      // The timeline denorm plugin recomputes steps right after the save
      // commits; refetch so the Timeline tab reflects the new template.
      await queryClient.invalidateQueries({
        queryKey: ["/api/grievances", grievance.id, "timeline-steps"],
      });
      toast({ title: "Timeline template updated" });
    } catch (error: any) {
      toast({
        title: "Failed to update timeline template",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Timeline Template</CardTitle>
      </CardHeader>
      <CardContent className="max-w-2xl space-y-4">
        <div className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-10 w-full" data-testid="skeleton-timeline-template" />
          ) : (
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger id="timeline-template" data-testid="select-timeline-template">
                <SelectValue placeholder="Select a timeline template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE} data-testid="option-timeline-template-none">
                  None
                </SelectItem>
                {(templates ?? []).map((t) => (
                  <SelectItem
                    key={t.id}
                    value={t.id}
                    data-testid={`option-timeline-template-${t.id}`}
                  >
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-sm text-muted-foreground">
            Associate a timeline template with this grievance, or choose None to
            clear it. Computed steps appear on the Timeline tab.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          data-testid="button-save-timeline-template"
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

function GrievanceStatusHistoryContent() {
  const { grievance } = useGrievanceLayout();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<StatusHistoryEntry | null>(null);
  const [formStatusId, setFormStatusId] = useState("");
  const [formDate, setFormDate] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<StatusHistoryEntry | null>(null);

  const { data: entries = [], isLoading } = useQuery<StatusHistoryEntry[]>({
    queryKey: ["/api/grievances", grievance.id, "status-history"],
  });

  const { data: statuses = [] } = useQuery<StatusOption[]>({
    queryKey: ["/api/options/grievance-status"],
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["/api/grievances", grievance.id, "status-history"],
    });
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievance.id] });
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
    // Status changes recompute the denorm timeline steps; refetch so the
    // Timeline tab reflects them.
    await queryClient.invalidateQueries({
      queryKey: ["/api/grievances", grievance.id, "timeline-steps"],
    });
  };

  const openAdd = () => {
    setEditingEntry(null);
    setFormStatusId("");
    setFormDate(toDatetimeLocal(new Date()));
    setDialogOpen(true);
  };

  const openEdit = (entry: StatusHistoryEntry) => {
    setEditingEntry(entry);
    setFormStatusId(entry.statusId);
    setFormDate(toDatetimeLocal(entry.date));
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        statusId: formStatusId,
        date: new Date(formDate).toISOString(),
      };
      if (editingEntry) {
        return apiRequest(
          "PATCH",
          `/api/grievances/${grievance.id}/status-history/${editingEntry.id}`,
          payload,
        );
      }
      return apiRequest("POST", `/api/grievances/${grievance.id}/status-history`, payload);
    },
    onSuccess: async () => {
      await invalidate();
      setDialogOpen(false);
      toast({ title: editingEntry ? "Entry updated" : "Entry added" });
    },
    onError: (error: any) => {
      toast({
        title: editingEntry ? "Failed to update entry" : "Failed to add entry",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (entryId: string) =>
      apiRequest("DELETE", `/api/grievances/${grievance.id}/status-history/${entryId}`),
    onSuccess: async () => {
      await invalidate();
      setDeleteTarget(null);
      toast({ title: "Entry deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete entry",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const canSave =
    formStatusId !== "" &&
    formDate !== "" &&
    !Number.isNaN(new Date(formDate).getTime());

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Status History</CardTitle>
        <Button onClick={openAdd} data-testid="button-add-status-entry">
          <Plus className="h-4 w-4 mr-2" />
          Add Entry
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4" data-testid="text-no-status-history">
            No status history yet. Add an entry to set this grievance's status.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-status-entry-${entry.id}`}>
                  <TableCell data-testid={`text-status-name-${entry.id}`}>
                    {entry.statusName ?? "—"}
                  </TableCell>
                  <TableCell data-testid={`text-status-date-${entry.id}`}>
                    {format(new Date(entry.date), "PPp")}
                  </TableCell>
                  <TableCell>
                    {entry.isCurrent && (
                      <Badge data-testid={`badge-current-${entry.id}`}>Current</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(entry)}
                        data-testid={`button-edit-status-entry-${entry.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(entry)}
                        data-testid={`button-delete-status-entry-${entry.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingEntry ? "Edit Entry" : "Add Entry"}</DialogTitle>
            <DialogDescription>
              The entry with the latest date becomes the grievance's current
              status. Dates may be in the past but not in the future.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formStatusId} onValueChange={setFormStatusId}>
                <SelectTrigger data-testid="select-entry-status">
                  <SelectValue placeholder="Select a status" />
                </SelectTrigger>
                <SelectContent>
                  {statuses
                    .filter((s) => s.isActive !== false)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id} data-testid={`option-entry-status-${s.id}`}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="entry-date">Date</Label>
              <Input
                id="entry-date"
                type="datetime-local"
                value={formDate}
                max={toDatetimeLocal(new Date())}
                onChange={(e) => setFormDate(e.target.value)}
                data-testid="input-entry-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel-entry"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || saveMutation.isPending}
              data-testid="button-save-entry"
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.isCurrent
                ? "This is the current status entry. Deleting it will make the next most recent entry current, or leave the grievance with no status."
                : "This status history entry will be permanently removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function GrievanceStatusHistory() {
  return (
    <GrievanceLayout activeTab="status-history">
      <div className="space-y-6">
        <GrievanceStatusHistoryContent />
        <TimelineTemplateCard />
      </div>
    </GrievanceLayout>
  );
}
