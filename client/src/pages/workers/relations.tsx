import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Pencil, Trash2, Users } from "lucide-react";

interface OtherWorker {
  id: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
}

interface WorkerRelationRow {
  id: string;
  worker1: string;
  worker2: string;
  relationType: string;
  startYmd: string | null;
  endYmd: string | null;
  data: any;
  role: "worker_1" | "worker_2";
  isActive: boolean;
  otherWorker: OtherWorker | null;
  relationTypeName: string | null;
}

interface WorkerRelationType {
  id: string;
  name: string;
}

interface WorkerSearchResult {
  workers: Array<{ id: string; siriusId: number; displayName: string }>;
  total: number;
}

function formatWorkerName(w: OtherWorker | null): string {
  if (!w) return "Unknown worker";
  const built = [w.given, w.family].filter(Boolean).join(" ").trim();
  return built || w.displayName || `Worker #${w.siriusId ?? ""}`.trim();
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ymdFromDate(value: string | null): string {
  if (!value) return "";
  // value may already be YYYY-MM-DD; otherwise parse
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RelationsContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("staff");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkerRelationRow | null>(null);
  const [formRelationType, setFormRelationType] = useState<string>("");
  const [formStartYmd, setFormStartYmd] = useState<string>("");
  const [formEndYmd, setFormEndYmd] = useState<string>("");
  const [formOtherWorkerId, setFormOtherWorkerId] = useState<string>("");
  const [formOtherWorkerLabel, setFormOtherWorkerLabel] = useState<string>("");
  const [workerSearch, setWorkerSearch] = useState<string>("");

  const { data: relations = [], isLoading } = useQuery<WorkerRelationRow[]>({
    queryKey: ["/api/workers", worker.id, "relations"],
  });

  const { data: relationTypes = [] } = useQuery<WorkerRelationType[]>({
    queryKey: ["/api/options/worker-relation-type"],
  });

  const { data: workerSearchResults } = useQuery<WorkerSearchResult>({
    queryKey: ["/api/workers/search", { q: workerSearch }],
    queryFn: async () => {
      const params = new URLSearchParams({ q: workerSearch, limit: "10" });
      const res = await fetch(`/api/workers/search?${params}`);
      if (!res.ok) return { workers: [], total: 0 };
      return res.json();
    },
    enabled: isModalOpen && !editing && workerSearch.trim().length >= 2,
  });

  const fromMe = useMemo(() => relations.filter((r) => r.role === "worker_1"), [relations]);
  const toMe = useMemo(() => relations.filter((r) => r.role === "worker_2"), [relations]);
  const fromMeActive = fromMe.filter((r) => r.isActive);
  const fromMeInactive = fromMe.filter((r) => !r.isActive);
  const toMeActive = toMe.filter((r) => r.isActive);
  const toMeInactive = toMe.filter((r) => !r.isActive);

  const createMutation = useMutation({
    mutationFn: async (data: {
      worker1: string;
      worker2: string;
      relationType: string;
      startYmd: string;
      endYmd: string | null;
    }) => {
      return apiRequest("POST", `/api/workers/${worker.id}/relations`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "relations"] });
      toast({ title: "Relation added", description: "The worker relation has been created." });
      closeModal();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to add relation.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { relationType: string; startYmd: string; endYmd: string | null };
    }) => {
      return apiRequest("PATCH", `/api/worker-relations/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "relations"] });
      toast({ title: "Relation updated", description: "The worker relation has been updated." });
      closeModal();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update relation.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/worker-relations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "relations"] });
      toast({ title: "Relation removed", description: "The worker relation has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove relation.", variant: "destructive" });
    },
  });

  function openAddModal() {
    setEditing(null);
    setFormRelationType("");
    setFormStartYmd(todayYmd());
    setFormEndYmd("");
    setFormOtherWorkerId("");
    setFormOtherWorkerLabel("");
    setWorkerSearch("");
    setIsModalOpen(true);
  }

  function openEditModal(row: WorkerRelationRow) {
    setEditing(row);
    setFormRelationType(row.relationType);
    setFormStartYmd(ymdFromDate(row.startYmd));
    setFormEndYmd(ymdFromDate(row.endYmd));
    setFormOtherWorkerId(row.otherWorker?.id ?? "");
    setFormOtherWorkerLabel(formatWorkerName(row.otherWorker));
    setWorkerSearch("");
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditing(null);
    setFormRelationType("");
    setFormStartYmd("");
    setFormEndYmd("");
    setFormOtherWorkerId("");
    setFormOtherWorkerLabel("");
    setWorkerSearch("");
  }

  function handleSave() {
    if (!formRelationType) {
      toast({ title: "Validation Error", description: "Relation type is required.", variant: "destructive" });
      return;
    }
    if (!formStartYmd) {
      toast({ title: "Validation Error", description: "Start date is required.", variant: "destructive" });
      return;
    }
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: {
          relationType: formRelationType,
          startYmd: formStartYmd,
          endYmd: formEndYmd || null,
        },
      });
    } else {
      if (!formOtherWorkerId) {
        toast({ title: "Validation Error", description: "Please choose a related worker.", variant: "destructive" });
        return;
      }
      if (formOtherWorkerId === worker.id) {
        toast({ title: "Validation Error", description: "Related worker must be different from this worker.", variant: "destructive" });
        return;
      }
      createMutation.mutate({
        worker1: worker.id,
        worker2: formOtherWorkerId,
        relationType: formRelationType,
        startYmd: formStartYmd,
        endYmd: formEndYmd || null,
      });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  function renderTable(rows: WorkerRelationRow[], emptyText: string, testIdPrefix: string) {
    if (rows.length === 0) {
      return (
        <div className="text-center py-6 text-muted-foreground" data-testid={`text-${testIdPrefix}-empty`}>
          {emptyText}
        </div>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Other Worker</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Start</TableHead>
            <TableHead>End</TableHead>
            {canEdit && <TableHead className="w-[120px]">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-testid={`row-${testIdPrefix}-${row.id}`}>
              <TableCell>
                {row.otherWorker ? (
                  <Link
                    href={`/workers/${row.otherWorker.id}`}
                    className="text-primary underline-offset-2 hover:underline"
                    data-testid={`link-other-worker-${row.id}`}
                  >
                    {formatWorkerName(row.otherWorker)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Unknown</span>
                )}
              </TableCell>
              <TableCell data-testid={`text-relation-type-${row.id}`}>{row.relationTypeName ?? row.relationType}</TableCell>
              <TableCell data-testid={`text-start-${row.id}`}>{row.startYmd ?? "—"}</TableCell>
              <TableCell data-testid={`text-end-${row.id}`}>{row.endYmd ?? "—"}</TableCell>
              {canEdit && (
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditModal(row)}
                      data-testid={`button-edit-${row.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-delete-${row.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove Relation</AlertDialogTitle>
                          <AlertDialogDescription>
                            Remove this worker relation? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(row.id)}
                            data-testid={`button-confirm-delete-${row.id}`}
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              <CardTitle>Worker Relations</CardTitle>
            </div>
            {canEdit && (
              <Button onClick={openAddModal} data-testid="button-add-relation">
                <Plus className="h-4 w-4 mr-2" />
                Add Relation
              </Button>
            )}
          </div>
          <CardDescription>
            Manage relationships from and to this worker. Relations are active when the start date is today or earlier and the end date is not yet past.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">From this worker</h3>
              <Badge variant="outline" data-testid="badge-from-count">
                {fromMeActive.length} active · {fromMeInactive.length} inactive
              </Badge>
            </div>
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Active</h4>
                {renderTable(fromMeActive, "No active relations from this worker.", "from-active")}
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Inactive</h4>
                {renderTable(fromMeInactive, "No inactive relations from this worker.", "from-inactive")}
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">To this worker</h3>
              <Badge variant="outline" data-testid="badge-to-count">
                {toMeActive.length} active · {toMeInactive.length} inactive
              </Badge>
            </div>
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Active</h4>
                {renderTable(toMeActive, "No active relations pointing to this worker.", "to-active")}
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Inactive</h4>
                {renderTable(toMeInactive, "No inactive relations pointing to this worker.", "to-inactive")}
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Relation" : "Add Relation"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the relation details. The worker pair cannot be changed."
                : "Create a new relation from this worker to another worker."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>From worker</Label>
              <div className="text-sm rounded-md border bg-muted px-3 py-2" data-testid="text-from-worker">
                {worker.id}
              </div>
            </div>

            <div className="space-y-2">
              <Label>To worker</Label>
              {editing ? (
                <div className="text-sm rounded-md border bg-muted px-3 py-2" data-testid="text-to-worker-readonly">
                  {formOtherWorkerLabel || formOtherWorkerId}
                </div>
              ) : (
                <div className="space-y-2">
                  {formOtherWorkerId ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                      <span className="text-sm" data-testid="text-selected-other-worker">{formOtherWorkerLabel}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFormOtherWorkerId("");
                          setFormOtherWorkerLabel("");
                          setWorkerSearch("");
                        }}
                        data-testid="button-clear-other-worker"
                      >
                        Clear
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Input
                        placeholder="Search workers by name..."
                        value={workerSearch}
                        onChange={(e) => setWorkerSearch(e.target.value)}
                        data-testid="input-search-worker"
                      />
                      {workerSearch.trim().length >= 2 && (
                        <div className="max-h-48 overflow-auto rounded-md border">
                          {(workerSearchResults?.workers ?? [])
                            .filter((w) => w.id !== worker.id)
                            .map((w) => (
                              <button
                                key={w.id}
                                type="button"
                                onClick={() => {
                                  setFormOtherWorkerId(w.id);
                                  setFormOtherWorkerLabel(w.displayName || `Worker #${w.siriusId}`);
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                                data-testid={`option-worker-${w.id}`}
                              >
                                {w.displayName || `Worker #${w.siriusId}`}
                                {w.siriusId ? <span className="text-muted-foreground"> · #{w.siriusId}</span> : null}
                              </button>
                            ))}
                          {(workerSearchResults?.workers ?? []).length === 0 && (
                            <div className="px-3 py-2 text-sm text-muted-foreground">No workers found.</div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="relation-type">Relation type</Label>
              <Select value={formRelationType} onValueChange={setFormRelationType}>
                <SelectTrigger id="relation-type" data-testid="select-relation-type">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {relationTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id} data-testid={`select-relation-type-${t.id}`}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="start-ymd">Start date</Label>
                <Input
                  id="start-ymd"
                  type="date"
                  value={formStartYmd}
                  onChange={(e) => setFormStartYmd(e.target.value)}
                  data-testid="input-start-ymd"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-ymd">End date</Label>
                <Input
                  id="end-ymd"
                  type="date"
                  value={formEndYmd}
                  onChange={(e) => setFormEndYmd(e.target.value)}
                  data-testid="input-end-ymd"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal} data-testid="button-cancel">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending} data-testid="button-save">
              {isPending ? "Saving..." : editing ? "Save Changes" : "Add Relation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WorkerRelationsPage() {
  return (
    <WorkerLayout activeTab="relations">
      <RelationsContent />
    </WorkerLayout>
  );
}
