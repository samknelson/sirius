import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/contexts/PageTitleContext";
import type { OpenEnrollmentWindow } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";

const API = "/api/trust/open-enrollment-windows";

type FormState = {
  planYear: string;
  startYmd: string;
  endYmd: string;
  notes: string;
};

const emptyForm: FormState = {
  planYear: String(new Date().getFullYear() + 1),
  startYmd: "",
  endYmd: "",
  notes: "",
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function isOpenNow(w: OpenEnrollmentWindow): boolean {
  const t = todayYmd();
  return w.startYmd <= t && t <= w.endYmd;
}

export default function OpenEnrollmentWindowsPage() {
  usePageTitle("Open Enrollment Windows");
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OpenEnrollmentWindow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<OpenEnrollmentWindow | null>(
    null,
  );

  const { data: windows, isLoading } = useQuery<OpenEnrollmentWindow[]>({
    queryKey: [API],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [API] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        planYear: Number(form.planYear),
        startYmd: form.startYmd,
        endYmd: form.endYmd,
        notes: form.notes.trim() ? form.notes.trim() : null,
      };
      if (editing) {
        return apiRequest("PATCH", `${API}/${editing.id}`, payload);
      }
      return apiRequest("POST", API, payload);
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      toast({
        title: editing ? "Window updated" : "Window created",
        description: editing
          ? "The Open Enrollment window was updated."
          : "The Open Enrollment window was created.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Could not save window",
        description: err?.message || "Please check the values and try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${API}/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast({
        title: "Window deleted",
        description: "The Open Enrollment window was removed.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Could not delete window",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (w: OpenEnrollmentWindow) => {
    setEditing(w);
    setForm({
      planYear: String(w.planYear),
      startYmd: w.startYmd,
      endYmd: w.endYmd,
      notes: w.notes ?? "",
    });
    setDialogOpen(true);
  };

  const canSave =
    form.planYear.trim() !== "" &&
    Number.isFinite(Number(form.planYear)) &&
    form.startYmd !== "" &&
    form.endYmd !== "" &&
    form.endYmd >= form.startYmd;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" />
              Open Enrollment Windows
            </CardTitle>
            <CardDescription>
              Set the dates when staff can run Open Enrollment for a worker. The
              election always takes effect on January 1 of the plan year.
            </CardDescription>
          </div>
          <Button onClick={openCreate} data-testid="button-add-window">
            <Plus className="h-4 w-4 mr-2" />
            Add Window
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground" data-testid="text-loading">
              Loading…
            </p>
          ) : !windows || windows.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="text-empty"
            >
              No Open Enrollment windows yet. Add one to let staff run Open
              Enrollment.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Year</TableHead>
                  <TableHead>Opens</TableHead>
                  <TableHead>Closes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {windows.map((w) => (
                  <TableRow key={w.id} data-testid={`row-window-${w.id}`}>
                    <TableCell
                      className="font-medium"
                      data-testid={`text-planyear-${w.id}`}
                    >
                      {w.planYear}
                    </TableCell>
                    <TableCell data-testid={`text-start-${w.id}`}>
                      {w.startYmd}
                    </TableCell>
                    <TableCell data-testid={`text-end-${w.id}`}>
                      {w.endYmd}
                    </TableCell>
                    <TableCell data-testid={`status-window-${w.id}`}>
                      {isOpenNow(w) ? (
                        <span className="text-green-600 dark:text-green-400 font-medium">
                          Open now
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Closed</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="max-w-xs truncate"
                      data-testid={`text-notes-${w.id}`}
                    >
                      {w.notes || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(w)}
                          data-testid={`button-edit-${w.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(w)}
                          data-testid={`button-delete-${w.id}`}
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
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Open Enrollment Window" : "Add Open Enrollment Window"}
            </DialogTitle>
            <DialogDescription>
              Choose the plan year and the dates the window is open.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="planYear">Plan year</Label>
              <Input
                id="planYear"
                type="number"
                value={form.planYear}
                onChange={(e) =>
                  setForm((f) => ({ ...f, planYear: e.target.value }))
                }
                data-testid="input-planyear"
              />
              <p className="text-xs text-muted-foreground">
                Elections in this window take effect on January 1, {form.planYear || "…"}.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="startYmd">Opens on</Label>
              <Input
                id="startYmd"
                type="date"
                value={form.startYmd}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startYmd: e.target.value }))
                }
                data-testid="input-start"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endYmd">Closes on</Label>
              <Input
                id="endYmd"
                type="date"
                value={form.endYmd}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endYmd: e.target.value }))
                }
                data-testid="input-end"
              />
              {form.startYmd && form.endYmd && form.endYmd < form.startYmd && (
                <p className="text-xs text-destructive">
                  The close date must be on or after the open date.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                data-testid="input-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || saveMutation.isPending}
              data-testid="button-save"
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this window?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the Open Enrollment window for plan year{" "}
              {deleteTarget?.planYear}. Elections already posted are not
              affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
              data-testid="button-delete-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
