import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  GrievanceTimelineTemplateLayout,
  useGrievanceTimelineTemplateLayout,
  type GrievanceTimelineTemplateStepDetails,
} from "@/components/layouts/GrievanceTimelineTemplateLayout";

interface OptionItem {
  id: string;
  name: string;
}
interface StepOptionItem {
  id: string;
  name: string;
  actor: string;
}

type DayType = "calendar" | "business";

interface StepFormState {
  fromStatuses: string[];
  toStatuses: string[];
  stepId: string;
  days: string;
  dayType: DayType;
}

const EMPTY_FORM: StepFormState = {
  fromStatuses: [],
  toStatuses: [],
  stepId: "",
  days: "0",
  dayType: "calendar",
};

function dayTypeLabel(dayType: DayType): string {
  return dayType === "business" ? "Business" : "Calendar";
}

function StatusNames({
  ids,
  statusMap,
  testid,
}: {
  ids: string[];
  statusMap: Map<string, string>;
  testid: string;
}) {
  if (ids.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1" data-testid={testid}>
      {ids.map((id) => (
        <Badge key={id} variant="secondary">
          {statusMap.get(id) || "Unknown"}
        </Badge>
      ))}
    </div>
  );
}

function ItemsContent() {
  const { template } = useGrievanceTimelineTemplateLayout();
  const { toast } = useToast();

  const { data: statuses = [] } = useQuery<OptionItem[]>({
    queryKey: ["/api/options/grievance-status"],
  });
  const { data: stepOptions = [] } = useQuery<StepOptionItem[]>({
    queryKey: ["/api/options/grievance-step"],
  });

  const {
    data: steps = [],
    isLoading,
  } = useQuery<GrievanceTimelineTemplateStepDetails[]>({
    queryKey: ["/api/grievance-timeline-templates", template.id, "steps"],
  });

  const statusMap = new Map(statuses.map((s) => [s.id, s.name]));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StepFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] =
    useState<GrievanceTimelineTemplateStepDetails | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(step: GrievanceTimelineTemplateStepDetails) {
    setEditingId(step.id);
    setForm({
      fromStatuses: step.fromStatuses,
      toStatuses: step.toStatuses,
      stepId: step.stepId,
      days: String(step.days),
      dayType: step.dayType,
    });
    setDialogOpen(true);
  }

  function toggleStatus(field: "fromStatuses" | "toStatuses", id: string) {
    setForm((prev) => {
      const current = prev[field];
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      return { ...prev, [field]: next };
    });
  }

  async function invalidate() {
    await queryClient.invalidateQueries({
      queryKey: ["/api/grievance-timeline-templates", template.id, "steps"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["/api/grievance-timeline-templates", template.id],
    });
  }

  async function handleSave() {
    if (form.fromStatuses.length === 0) {
      toast({ title: "Select at least one 'from' status", variant: "destructive" });
      return;
    }
    if (form.toStatuses.length === 0) {
      toast({ title: "Select at least one 'to' status", variant: "destructive" });
      return;
    }
    if (!form.stepId) {
      toast({ title: "Select a step", variant: "destructive" });
      return;
    }
    const daysNum = Number(form.days);
    if (!Number.isInteger(daysNum) || daysNum < 0) {
      toast({ title: "Days must be zero or a positive whole number", variant: "destructive" });
      return;
    }

    const body = {
      fromStatuses: form.fromStatuses,
      toStatuses: form.toStatuses,
      stepId: form.stepId,
      days: daysNum,
      dayType: form.dayType,
    };

    setSaving(true);
    try {
      if (editingId) {
        await apiRequest(
          "PATCH",
          `/api/grievance-timeline-templates/${template.id}/steps/${editingId}`,
          body,
        );
        toast({ title: "Step updated" });
      } else {
        await apiRequest(
          "POST",
          `/api/grievance-timeline-templates/${template.id}/steps`,
          body,
        );
        toast({ title: "Step added" });
      }
      await invalidate();
      setDialogOpen(false);
    } catch (error) {
      toast({
        title: "Could not save step",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(
        "DELETE",
        `/api/grievance-timeline-templates/${template.id}/steps/${deleteTarget.id}`,
      );
      await invalidate();
      toast({ title: "Step removed" });
      setDeleteTarget(null);
    } catch (error) {
      toast({
        title: "Could not remove step",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Steps</CardTitle>
          <Button onClick={openAdd} data-testid="button-add-step">
            <Plus size={16} className="mr-2" />
            Add Step
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : steps.length === 0 ? (
            <p
              className="text-muted-foreground text-sm py-8 text-center"
              data-testid="text-no-steps"
            >
              No steps yet. Add one to build out the timeline.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>To Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((step) => (
                  <TableRow key={step.id} data-testid={`row-step-${step.id}`}>
                    <TableCell>
                      <StatusNames
                        ids={step.fromStatuses}
                        statusMap={statusMap}
                        testid={`text-from-${step.id}`}
                      />
                    </TableCell>
                    <TableCell data-testid={`text-due-${step.id}`}>
                      {step.days} {dayTypeLabel(step.dayType)} Days
                    </TableCell>
                    <TableCell data-testid={`text-actor-${step.id}`}>
                      {step.stepActor || "—"}
                    </TableCell>
                    <TableCell data-testid={`text-step-${step.id}`}>
                      {step.stepName || "—"}
                    </TableCell>
                    <TableCell>
                      <StatusNames
                        ids={step.toStatuses}
                        statusMap={statusMap}
                        testid={`text-to-${step.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(step)}
                          data-testid={`button-edit-step-${step.id}`}
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(step)}
                          data-testid={`button-delete-step-${step.id}`}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Step" : "Add Step"}</DialogTitle>
            <DialogDescription>
              A step fires when a grievance moves from any of the selected
              statuses, and sets the due date for the chosen step.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>From Status</Label>
              <div className="space-y-2 rounded-md border p-3">
                {statuses.map((status) => (
                  <label
                    key={status.id}
                    className="flex items-center gap-2 text-sm"
                    data-testid={`check-from-${status.id}`}
                  >
                    <Checkbox
                      checked={form.fromStatuses.includes(status.id)}
                      onCheckedChange={() => toggleStatus("fromStatuses", status.id)}
                    />
                    {status.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>To Status</Label>
              <div className="space-y-2 rounded-md border p-3">
                {statuses.map((status) => (
                  <label
                    key={status.id}
                    className="flex items-center gap-2 text-sm"
                    data-testid={`check-to-${status.id}`}
                  >
                    <Checkbox
                      checked={form.toStatuses.includes(status.id)}
                      onCheckedChange={() => toggleStatus("toStatuses", status.id)}
                    />
                    {status.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Step</Label>
              <Select
                value={form.stepId}
                onValueChange={(value) => setForm((p) => ({ ...p, stepId: value }))}
              >
                <SelectTrigger data-testid="select-step">
                  <SelectValue placeholder="Select a step" />
                </SelectTrigger>
                <SelectContent>
                  {stepOptions.map((step) => (
                    <SelectItem key={step.id} value={step.id}>
                      {step.name} ({step.actor})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="step-days">Days</Label>
                <Input
                  id="step-days"
                  type="number"
                  min={0}
                  value={form.days}
                  onChange={(e) => setForm((p) => ({ ...p, days: e.target.value }))}
                  data-testid="input-step-days"
                />
              </div>
              <div className="space-y-2">
                <Label>Day Type</Label>
                <Select
                  value={form.dayType}
                  onValueChange={(value) =>
                    setForm((p) => ({ ...p, dayType: value as DayType }))
                  }
                >
                  <SelectTrigger data-testid="select-day-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="calendar">Calendar</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel-step"
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-step">
              {saving ? "Saving..." : editingId ? "Save Changes" : "Add Step"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Step</DialogTitle>
            <DialogDescription>
              This will remove the step from the timeline template. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              data-testid="button-cancel-delete-step"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              data-testid="button-confirm-delete-step"
            >
              {deleting ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function GrievanceTimelineTemplateItems() {
  return (
    <GrievanceTimelineTemplateLayout activeTab="items">
      <ItemsContent />
    </GrievanceTimelineTemplateLayout>
  );
}
