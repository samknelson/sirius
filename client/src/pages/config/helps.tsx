import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { HelpCircle, Plus, Loader2, Trash2, Pencil, X } from "lucide-react";
import type { Help } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";

interface HelpFormState {
  paths: string[];
  summary: string;
  details: string;
}

const emptyForm: HelpFormState = { paths: [""], summary: "", details: "" };

/** Strip HTML tags so the content filter matches visible text, not markup. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

type HelpWithSource = Help & { source?: "system" | "config" };

export default function HelpsConfigPage() {
  usePageTitle("Help Text");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<HelpFormState>(emptyForm);
  const [contentFilter, setContentFilter] = useState("");
  const [pathFilter, setPathFilter] = useState("");

  const { data: helpEntries = [], isLoading } = useQuery<HelpWithSource[]>({
    queryKey: ["/api/helps"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/helps"] });
    queryClient.invalidateQueries({ queryKey: ["/api/helps/lookup"] });
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (help: Help) => {
    setEditingId(help.id);
    setForm({
      paths: help.paths.length > 0 ? [...help.paths] : [""],
      summary: help.summary,
      details: help.details || "",
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: { paths: string[]; summary: string; details: string | null }) =>
      editingId
        ? apiRequest("PUT", `/api/helps/${editingId}`, payload)
        : apiRequest("POST", "/api/helps", payload),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      toast({ title: "Success", description: editingId ? "Help entry updated." : "Help entry created." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to save help entry."),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/helps/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
      toast({ title: "Success", description: "Help entry deleted." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to delete help entry."),
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const paths = form.paths.map((p) => p.trim()).filter((p) => p.length > 0);
    if (paths.length === 0) {
      toast({ title: "Validation Error", description: "At least one path pattern is required.", variant: "destructive" });
      return;
    }
    if (!form.summary.trim()) {
      toast({ title: "Validation Error", description: "Summary is required.", variant: "destructive" });
      return;
    }
    saveMutation.mutate({
      paths,
      summary: form.summary.trim(),
      details: form.details.trim() ? form.details : null,
    });
  };

  const setPath = (index: number, value: string) => {
    setForm((f) => ({ ...f, paths: f.paths.map((p, i) => (i === index ? value : p)) }));
  };

  const visibleEntries = useMemo(() => {
    const content = contentFilter.trim().toLowerCase();
    const path = pathFilter.trim().toLowerCase();
    const filtered = helpEntries.filter((h) => {
      if (content) {
        const haystack = `${h.summary} ${h.details ? stripHtml(h.details) : ""}`.toLowerCase();
        if (!haystack.includes(content)) return false;
      }
      if (path && !h.paths.some((p) => p.toLowerCase().includes(path))) {
        return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      const pa = a.paths[0]?.toLowerCase();
      const pb = b.paths[0]?.toLowerCase();
      if (pa === undefined && pb === undefined) {
        return a.summary.localeCompare(b.summary, undefined, { sensitivity: "base" });
      }
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return (
        pa.localeCompare(pb) ||
        a.summary.localeCompare(b.summary, undefined, { sensitivity: "base" })
      );
    });
  }, [helpEntries, contentFilter, pathFilter]);

  const deleteTarget = helpEntries.find((h) => h.id === deleteId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-helps-title">
            <HelpCircle className="h-6 w-6" />
            Help Text
          </h1>
          <p className="text-muted-foreground mt-1">
            Configurable help shown on matching pages. Path patterns support <code>%</code> wildcards.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-help">
          <Plus className="h-4 w-4 mr-2" />
          Add Help Entry
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Help Entries</CardTitle>
          <CardDescription>
            Each entry appears on every page whose URL matches one of its path patterns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {helpEntries.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center" data-testid="text-no-helps">
              No help entries yet. Add one to show help text on a page.
            </p>
          ) : (
            <>
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <Input
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                placeholder="Filter by path…"
                className="sm:max-w-xs font-mono"
                data-testid="input-filter-path"
              />
              <Input
                value={contentFilter}
                onChange={(e) => setContentFilter(e.target.value)}
                placeholder="Filter by content (summary or details)…"
                className="sm:max-w-sm"
                data-testid="input-filter-content"
              />
            </div>
            {visibleEntries.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center" data-testid="text-no-matching-helps">
                No help entries match the current filters.
              </p>
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paths</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEntries.map((help) => (
                  <TableRow key={help.id} data-testid={`row-help-${help.id}`}>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {help.paths.map((p, i) => (
                          <Badge key={i} variant="secondary" className="font-mono text-xs" data-testid={`badge-help-path-${help.id}-${i}`}>
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md" data-testid={`text-help-summary-${help.id}`}>
                      <div className="flex items-center gap-2">
                        <span>{help.summary}</span>
                        {help.source === "system" && (
                          <Badge variant="outline" data-testid={`badge-help-system-${help.id}`}>
                            System
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {help.details ? (
                        <Badge variant="outline">Yes</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {help.source === "system" ? (
                        <span className="text-muted-foreground text-xs" data-testid={`text-help-builtin-${help.id}`}>
                          Built-in
                        </span>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(help)}
                            data-testid={`button-edit-help-${help.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(help.id)}
                            data-testid={`button-delete-help-${help.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Help Entry" : "Add Help Entry"}</DialogTitle>
            <DialogDescription>
              Path patterns match the page URL; use <code>%</code> as a wildcard (e.g.{" "}
              <code>/workers/%/hours</code>).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Path Patterns</Label>
              {form.paths.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={p}
                    onChange={(e) => setPath(i, e.target.value)}
                    placeholder="/config/example or /workers/%/hours"
                    className="font-mono"
                    data-testid={`input-help-path-${i}`}
                  />
                  {form.paths.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setForm((f) => ({ ...f, paths: f.paths.filter((_, j) => j !== i) }))}
                      data-testid={`button-remove-help-path-${i}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, paths: [...f.paths, ""] }))}
                data-testid="button-add-help-path"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Path
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="help-summary">Summary</Label>
              <Textarea
                id="help-summary"
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                placeholder="Short help text shown inline on the page"
                rows={2}
                data-testid="input-help-summary"
              />
            </div>
            <div className="space-y-2">
              <Label>Details (optional)</Label>
              <SimpleHtmlEditor
                value={form.details}
                onChange={(value) => setForm((f) => ({ ...f, details: value }))}
                placeholder="Longer help content shown in the 'more' dialog"
                minHeight={160}
                data-testid="input-help-details"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-help">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-help">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Help Entry</DialogTitle>
            <DialogDescription>
              This will permanently remove the help entry{deleteTarget ? ` "${deleteTarget.summary.slice(0, 60)}"` : ""}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} data-testid="button-cancel-delete-help">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-help"
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
