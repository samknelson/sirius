import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import type { FreemanCrewlead } from "@shared/schema/sitespecific/freeman/schema";

type SortKey = "siriusId" | "name";
type SortDir = "asc" | "desc";

const QUERY_KEY = ["/api/sitespecific/freeman/crewleads"] as const;

interface RowDraft {
  siriusId: string;
  name: string;
}

export default function FreemanCrewleadsListPage() {
  usePageTitle("Freeman Crew Leads");
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canEdit = hasPermission("edls.manager");

  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RowDraft>({ siriusId: "", name: "" });
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<RowDraft>({ siriusId: "", name: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: rows = [], isLoading, isError } = useQuery<FreemanCrewlead[]>({
    queryKey: QUERY_KEY,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const handleApiError = (err: unknown, fallback: string) => {
    const message =
      err instanceof Error && err.message
        ? err.message.replace(/^\d+:\s*/, "")
        : fallback;
    let parsed = message;
    try {
      const m = message.match(/\{[\s\S]*\}$/);
      if (m) {
        const json = JSON.parse(m[0]);
        if (json?.message) parsed = json.message;
      }
    } catch {
      /* keep parsed */
    }
    toast({ title: "Error", description: parsed, variant: "destructive" });
  };

  const createMutation = useMutation({
    mutationFn: async (input: RowDraft) => {
      return apiRequest("POST", "/api/sitespecific/freeman/crewleads", input);
    },
    onSuccess: () => {
      toast({ title: "Crew lead added" });
      setAdding(false);
      setNewDraft({ siriusId: "", name: "" });
      invalidate();
    },
    onError: (err) => handleApiError(err, "Failed to create crew lead"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: RowDraft }) => {
      return apiRequest(
        "PATCH",
        `/api/sitespecific/freeman/crewleads/${id}`,
        input,
      );
    },
    onSuccess: () => {
      toast({ title: "Crew lead updated" });
      setEditingId(null);
      invalidate();
    },
    onError: (err) => handleApiError(err, "Failed to update crew lead"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(
        "DELETE",
        `/api/sitespecific/freeman/crewleads/${id}`,
      );
    },
    onSuccess: () => {
      toast({ title: "Crew lead deleted" });
      setConfirmDeleteId(null);
      invalidate();
    },
    onError: (err) => handleApiError(err, "Failed to delete crew lead"),
  });

  const visibleRows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const filtered = term
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(term) ||
            r.siriusId.toLowerCase().includes(term),
        )
      : rows;
    const sorted = [...filtered].sort((a, b) => {
      const av = (a[sortKey] ?? "").toString().toLowerCase();
      const bv = (b[sortKey] ?? "").toString().toLowerCase();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const startEdit = (row: FreemanCrewlead) => {
    setEditingId(row.id);
    setDraft({ siriusId: row.siriusId, name: row.name });
    setAdding(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = (id: string) => {
    if (!draft.siriusId.trim() || !draft.name.trim()) {
      toast({
        title: "Missing values",
        description: "Sirius ID and Name are both required.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({
      id,
      input: { siriusId: draft.siriusId.trim(), name: draft.name.trim() },
    });
  };

  const startAdd = () => {
    setEditingId(null);
    setAdding(true);
    setNewDraft({ siriusId: "", name: "" });
  };

  const saveAdd = () => {
    if (!newDraft.siriusId.trim() || !newDraft.name.trim()) {
      toast({
        title: "Missing values",
        description: "Sirius ID and Name are both required.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      siriusId: newDraft.siriusId.trim(),
      name: newDraft.name.trim(),
    });
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1" />
    );
  };

  return (
    <div className="container mx-auto py-6 px-4 space-y-4" data-testid="page-freeman-crewleads">
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-page-title">Freeman Crew Leads</CardTitle>
          <CardDescription>
            Manage the list of Freeman crew leads. Each entry must have a unique
            Sirius ID.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            <Input
              type="search"
              placeholder="Filter by Sirius ID or name..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-md"
              data-testid="input-filter-crewleads"
            />
            {canEdit && (
              <Button
                onClick={startAdd}
                disabled={adding}
                data-testid="button-add-crewlead"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Crew Lead
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading crew leads...
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-destructive" data-testid="text-error">
              Failed to load crew leads.
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">
                      <button
                        type="button"
                        className="inline-flex items-center hover-elevate active-elevate-2 px-2 py-1 -mx-2 rounded"
                        onClick={() => toggleSort("siriusId")}
                        data-testid="button-sort-siriusid"
                      >
                        Sirius ID {sortIcon("siriusId")}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        className="inline-flex items-center hover-elevate active-elevate-2 px-2 py-1 -mx-2 rounded"
                        onClick={() => toggleSort("name")}
                        data-testid="button-sort-name"
                      >
                        Name {sortIcon("name")}
                      </button>
                    </TableHead>
                    {canEdit && (
                      <TableHead className="w-[140px] text-right">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adding && canEdit && (
                    <TableRow data-testid="row-crewlead-new">
                      <TableCell>
                        <Input
                          value={newDraft.siriusId}
                          onChange={(e) =>
                            setNewDraft({ ...newDraft, siriusId: e.target.value })
                          }
                          placeholder="Sirius ID"
                          autoFocus
                          data-testid="input-new-siriusid"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={newDraft.name}
                          onChange={(e) =>
                            setNewDraft({ ...newDraft, name: e.target.value })
                          }
                          placeholder="Name"
                          data-testid="input-new-name"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            onClick={saveAdd}
                            disabled={createMutation.isPending}
                            data-testid="button-save-new"
                          >
                            {createMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAdding(false)}
                            disabled={createMutation.isPending}
                            data-testid="button-cancel-new"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {visibleRows.length === 0 && !adding ? (
                    <TableRow>
                      <TableCell
                        colSpan={canEdit ? 3 : 2}
                        className="text-center text-muted-foreground py-8"
                        data-testid="text-empty"
                      >
                        {filter
                          ? "No crew leads match your filter."
                          : "No crew leads yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleRows.map((row) => {
                      const isEditing = editingId === row.id;
                      return (
                        <TableRow key={row.id} data-testid={`row-crewlead-${row.id}`}>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                value={draft.siriusId}
                                onChange={(e) =>
                                  setDraft({ ...draft, siriusId: e.target.value })
                                }
                                autoFocus
                                data-testid={`input-edit-siriusid-${row.id}`}
                              />
                            ) : (
                              <span data-testid={`text-siriusid-${row.id}`}>
                                {row.siriusId}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                value={draft.name}
                                onChange={(e) =>
                                  setDraft({ ...draft, name: e.target.value })
                                }
                                data-testid={`input-edit-name-${row.id}`}
                              />
                            ) : (
                              <span data-testid={`text-name-${row.id}`}>{row.name}</span>
                            )}
                          </TableCell>
                          {canEdit && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {isEditing ? (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() => saveEdit(row.id)}
                                      disabled={updateMutation.isPending}
                                      data-testid={`button-save-${row.id}`}
                                    >
                                      {updateMutation.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Save className="h-4 w-4" />
                                      )}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={cancelEdit}
                                      disabled={updateMutation.isPending}
                                      data-testid={`button-cancel-${row.id}`}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => startEdit(row)}
                                      data-testid={`button-edit-${row.id}`}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setConfirmDeleteId(row.id)}
                                      data-testid={`button-delete-${row.id}`}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="text-sm text-muted-foreground" data-testid="text-row-count">
            {visibleRows.length} of {rows.length} crew lead
            {rows.length === 1 ? "" : "s"}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete crew lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this crew lead. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmDeleteId && deleteMutation.mutate(confirmDeleteId)
              }
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
