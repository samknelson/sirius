import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { CalendarOff, Play, Square, Pencil, Trash2, Save, X } from "lucide-react";
import type { WorkerTos } from "@shared/schema";

function toDatetimeLocal(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDisplay(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatDuration(start: Date | string, end: Date | string | null): string {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = end ? (typeof end === "string" ? new Date(end) : end) : new Date();
  const ms = e.getTime() - s.getTime();
  if (ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(" ");
}

interface EditState {
  startDate: string;
  endDate: string;
  description: string;
  siriusId: string;
}

function TosContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("staff");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditState | null>(null);

  const { data: records = [], isLoading } = useQuery<WorkerTos[]>({
    queryKey: ["/api/workers", worker.id, "tos"],
  });

  const activeRecord = records.find((r) => r.endDate === null);

  const showApiError = (err: unknown, fallback: string) => {
    const message = err instanceof Error && err.message ? err.message : fallback;
    toast({ title: "Error", description: message, variant: "destructive" });
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/workers/${worker.id}/tos/start`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "tos"] });
      toast({ title: "Absence started", description: "An absence record was created." });
    },
    onError: (err) => showApiError(err, "Failed to start absence"),
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/workers/${worker.id}/tos/stop`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "tos"] });
      toast({ title: "Absence ended", description: "The active absence has been ended." });
    },
    onError: (err) => showApiError(err, "Failed to stop absence"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      return apiRequest("PATCH", `/api/worker-tos/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "tos"] });
      toast({ title: "Saved", description: "Absence record updated." });
      setEditingId(null);
      setEditValues(null);
    },
    onError: (err) => showApiError(err, "Failed to update absence"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/worker-tos/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "tos"] });
      toast({ title: "Deleted", description: "Absence record removed." });
    },
    onError: (err) => showApiError(err, "Failed to delete absence"),
  });

  const beginEdit = (rec: WorkerTos) => {
    setEditingId(rec.id);
    setEditValues({
      startDate: toDatetimeLocal(rec.startDate),
      endDate: toDatetimeLocal(rec.endDate),
      description: rec.description ?? "",
      siriusId: rec.siriusId ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues(null);
  };

  const saveEdit = (rec: WorkerTos) => {
    if (!editValues) return;
    const body: Record<string, unknown> = {};
    const newStart = editValues.startDate ? new Date(editValues.startDate).toISOString() : null;
    if (newStart && newStart !== new Date(rec.startDate).toISOString()) {
      body.startDate = newStart;
    }
    const oldEndIso = rec.endDate ? new Date(rec.endDate).toISOString() : null;
    const newEndIso = editValues.endDate ? new Date(editValues.endDate).toISOString() : null;
    if (newEndIso !== oldEndIso) {
      body.endDate = newEndIso;
    }
    const newDesc = editValues.description.trim() === "" ? null : editValues.description;
    if (newDesc !== (rec.description ?? null)) {
      body.description = newDesc;
    }
    const newSirius = editValues.siriusId.trim() === "" ? null : editValues.siriusId;
    if (newSirius !== (rec.siriusId ?? null)) {
      body.siriusId = newSirius;
    }
    if (Object.keys(body).length === 0) {
      cancelEdit();
      return;
    }
    updateMutation.mutate({ id: rec.id, body });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Time Off Sick</CardTitle>
          <CardDescription>Loading absences...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarOff className="h-5 w-5" />
            Time Off Sick
          </CardTitle>
          <CardDescription>
            Record and manage unplanned-absence periods for this worker
          </CardDescription>
        </div>
        {canEdit && (
          activeRecord ? (
            <Button
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              className="bg-amber-600 text-white hover:bg-amber-700"
              data-testid="button-stop-absence"
            >
              <Square className="h-4 w-4 mr-2" />
              {stopMutation.isPending
                ? "Stopping..."
                : `Stop absence (started ${formatDuration(activeRecord.startDate, null)} ago)`}
            </Button>
          ) : (
            <Button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              data-testid="button-start-absence"
            >
              <Play className="h-4 w-4 mr-2" />
              {startMutation.isPending ? "Starting..." : "Start an absence"}
            </Button>
          )
        )}
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-tos-records">
            <CalendarOff className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No absence records for this worker</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Sirius ID</TableHead>
                {canEdit && <TableHead className="w-[140px]">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec) => {
                const isEditing = editingId === rec.id && editValues !== null;
                return (
                  <TableRow key={rec.id} data-testid={`row-worker-tos-${rec.id}`}>
                    <TableCell>
                      {isEditing ? (
                        <Input
                          type="datetime-local"
                          value={editValues!.startDate}
                          onChange={(e) =>
                            setEditValues((v) => (v ? { ...v, startDate: e.target.value } : v))
                          }
                          data-testid={`input-start-date-${rec.id}`}
                        />
                      ) : (
                        <span data-testid={`text-start-date-${rec.id}`}>{formatDisplay(rec.startDate)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input
                          type="datetime-local"
                          value={editValues!.endDate}
                          onChange={(e) =>
                            setEditValues((v) => (v ? { ...v, endDate: e.target.value } : v))
                          }
                          data-testid={`input-end-date-${rec.id}`}
                        />
                      ) : rec.endDate ? (
                        <span data-testid={`text-end-date-${rec.id}`}>{formatDisplay(rec.endDate)}</span>
                      ) : (
                        <span className="text-amber-600 font-medium" data-testid={`text-end-date-${rec.id}`}>Active</span>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-duration-${rec.id}`}>
                      {formatDuration(rec.startDate, rec.endDate)}
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input
                          value={editValues!.description}
                          onChange={(e) =>
                            setEditValues((v) => (v ? { ...v, description: e.target.value } : v))
                          }
                          placeholder="Description"
                          data-testid={`input-description-${rec.id}`}
                        />
                      ) : (
                        <span data-testid={`text-description-${rec.id}`}>{rec.description || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input
                          value={editValues!.siriusId}
                          onChange={(e) =>
                            setEditValues((v) => (v ? { ...v, siriusId: e.target.value } : v))
                          }
                          placeholder="Sirius ID"
                          data-testid={`input-sirius-id-${rec.id}`}
                        />
                      ) : (
                        <span data-testid={`text-sirius-id-${rec.id}`}>{rec.siriusId || "—"}</span>
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {isEditing ? (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => saveEdit(rec)}
                                disabled={updateMutation.isPending}
                                data-testid={`button-save-${rec.id}`}
                              >
                                <Save className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={cancelEdit}
                                data-testid={`button-cancel-${rec.id}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => beginEdit(rec)}
                                data-testid={`button-edit-${rec.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm("Delete this absence record?")) {
                                    deleteMutation.mutate(rec.id);
                                  }
                                }}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-delete-${rec.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerTosPage() {
  return (
    <WorkerLayout activeTab="tos">
      <TosContent />
    </WorkerLayout>
  );
}
