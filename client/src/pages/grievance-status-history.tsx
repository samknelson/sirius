import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  readTimelineAdjustment,
  type GrievanceTimelineAdjustment,
  type GrievanceTimelineTemplate,
} from "@shared/schema";
import { formatYmd as formatYmdLong } from "@shared/utils/date";

const NONE_VALUE = "__none__";

interface StatusHistoryEntry {
  id: string;
  grievanceId: string;
  statusId: string;
  date: string;
  isCurrent: boolean;
  statusName: string | null;
  data: unknown;
}

/** Human-readable description of a timeline adjustment. */
export function describeAdjustment(adj: GrievanceTimelineAdjustment): string {
  if (adj.kind === "relative") {
    const abs = Math.abs(adj.days);
    return `${adj.days > 0 ? "+" : "-"}${abs} day${abs === 1 ? "" : "s"}`;
  }
  return `due set to ${formatYmdLong(adj.date, "short")}`;
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

  const [adjustTarget, setAdjustTarget] = useState<StatusHistoryEntry | null>(null);
  const [adjustMode, setAdjustMode] = useState<"relative" | "explicit">("relative");
  const [adjustDays, setAdjustDays] = useState("");
  const [adjustDate, setAdjustDate] = useState("");

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

  const openAdjust = (entry: StatusHistoryEntry) => {
    const existing = readTimelineAdjustment(entry.data);
    if (existing?.kind === "explicit") {
      setAdjustMode("explicit");
      setAdjustDate(existing.date);
      setAdjustDays("");
    } else {
      setAdjustMode("relative");
      setAdjustDays(existing?.kind === "relative" ? String(existing.days) : "");
      setAdjustDate("");
    }
    setAdjustTarget(entry);
  };

  const adjustMutation = useMutation({
    mutationFn: async (adjustment: GrievanceTimelineAdjustment | null) => {
      if (!adjustTarget) return;
      return apiRequest(
        "PUT",
        `/api/grievances/${grievance.id}/status-history/${adjustTarget.id}/timeline-adjustment`,
        { adjustment },
      );
    },
    onSuccess: async (_data, adjustment) => {
      await invalidate();
      setAdjustTarget(null);
      toast({
        title: adjustment === null ? "Timeline adjustment removed" : "Timeline adjustment saved",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save timeline adjustment",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const parsedAdjustDays = Number(adjustDays);
  const canSaveAdjustment =
    adjustMode === "relative"
      ? adjustDays.trim() !== "" && Number.isInteger(parsedAdjustDays) && parsedAdjustDays !== 0
      : /^\d{4}-\d{2}-\d{2}$/.test(adjustDate);

  const saveAdjustment = () => {
    const adjustment: GrievanceTimelineAdjustment =
      adjustMode === "relative"
        ? { kind: "relative", days: parsedAdjustDays }
        : { kind: "explicit", date: adjustDate };
    adjustMutation.mutate(adjustment);
  };

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
                <TableHead>Timeline Adjustment</TableHead>
                <TableHead></TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const adjustment = readTimelineAdjustment(entry.data);
                return (
                <TableRow key={entry.id} data-testid={`row-status-entry-${entry.id}`}>
                  <TableCell data-testid={`text-status-name-${entry.id}`}>
                    {entry.statusName ?? "—"}
                  </TableCell>
                  <TableCell data-testid={`text-status-date-${entry.id}`}>
                    {format(new Date(entry.date), "PPp")}
                  </TableCell>
                  <TableCell>
                    {adjustment && (
                      <Badge
                        variant="outline"
                        data-testid={`badge-adjustment-${entry.id}`}
                      >
                        <CalendarClock className="h-3 w-3 mr-1" />
                        {describeAdjustment(adjustment)}
                      </Badge>
                    )}
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
                        title="Adjust timeline"
                        onClick={() => openAdjust(entry)}
                        data-testid={`button-adjust-timeline-${entry.id}`}
                      >
                        <CalendarClock className="h-4 w-4" />
                      </Button>
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
                );
              })}
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

      <Dialog
        open={adjustTarget !== null}
        onOpenChange={(open) => !open && setAdjustTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Timeline</DialogTitle>
            <DialogDescription>
              Extend or shorten the deadline of the timeline step this entry
              starts. Add or subtract days (business-day steps count business
              days), or set an exact due date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Adjustment type</Label>
              <Select
                value={adjustMode}
                onValueChange={(v) => setAdjustMode(v as "relative" | "explicit")}
              >
                <SelectTrigger data-testid="select-adjustment-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relative" data-testid="option-adjustment-relative">
                    Add / subtract days
                  </SelectItem>
                  <SelectItem value="explicit" data-testid="option-adjustment-explicit">
                    Set exact due date
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {adjustMode === "relative" ? (
              <div className="space-y-2">
                <Label htmlFor="adjust-days">Days (+ extends, − shortens)</Label>
                <Input
                  id="adjust-days"
                  type="number"
                  step="1"
                  placeholder="e.g. 5 or -3"
                  value={adjustDays}
                  onChange={(e) => setAdjustDays(e.target.value)}
                  data-testid="input-adjustment-days"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="adjust-date">Due date</Label>
                <Input
                  id="adjust-date"
                  type="date"
                  value={adjustDate}
                  onChange={(e) => setAdjustDate(e.target.value)}
                  data-testid="input-adjustment-date"
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {adjustTarget && readTimelineAdjustment(adjustTarget.data) && (
                <Button
                  variant="destructive"
                  onClick={() => adjustMutation.mutate(null)}
                  disabled={adjustMutation.isPending}
                  data-testid="button-remove-adjustment"
                >
                  Remove adjustment
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setAdjustTarget(null)}
                data-testid="button-cancel-adjustment"
              >
                Cancel
              </Button>
              <Button
                onClick={saveAdjustment}
                disabled={!canSaveAdjustment || adjustMutation.isPending}
                data-testid="button-save-adjustment"
              >
                {adjustMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
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
