import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Paperclip, Download, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  BaoRateSourceWithDetails,
  BaoRateSourceType,
} from "@shared/schema/sitespecific/bao/schema";

interface Employer {
  id: string;
  name: string;
}

interface AttachmentFile {
  id: string;
  fileName: string;
  mimeType: string | null;
  size: number;
}

const TYPE_LABELS: Record<BaoRateSourceType, string> = {
  contract: "Contract",
  rate_letter: "Rate Letter",
};

function formatYmd(value: string | null | undefined): string {
  if (!value) return "—";
  const ymd = value.slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SOURCES_KEY = ["/api/sitespecific/bao/rate-sources"] as const;

export default function BaoRateSourcesPage() {
  usePageTitle("BAO Benefit Rate Sources");
  const { toast } = useToast();

  // Create / edit dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<BaoRateSourceType>("contract");
  const [startYmd, setStartYmd] = useState("");
  const [employerIds, setEmployerIds] = useState<Set<string>>(new Set());
  const [employerSearch, setEmployerSearch] = useState("");

  // Attachments dialog
  const [attachSource, setAttachSource] = useState<BaoRateSourceWithDetails | null>(null);
  const [uploading, setUploading] = useState(false);

  // Delete confirmation
  const [deleting, setDeleting] = useState<BaoRateSourceWithDetails | null>(null);

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const {
    data: sources = [],
    isLoading,
    error,
  } = useQuery<BaoRateSourceWithDetails[]>({
    queryKey: SOURCES_KEY,
  });

  const attachmentsKey = attachSource
    ? (["/api/sitespecific/bao/rate-sources", attachSource.id, "attachments"] as const)
    : null;
  const { data: attachments = [], isLoading: attachmentsLoading } = useQuery<AttachmentFile[]>({
    queryKey: attachmentsKey ?? ["__bao_rate_source_attachments_disabled__"],
    enabled: !!attachSource,
    queryFn: async () => {
      const res = await fetch(
        `/api/sitespecific/bao/rate-sources/${attachSource!.id}/attachments`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to load attachments");
      }
      return res.json();
    },
  });

  const invalidateSources = () => queryClient.invalidateQueries({ queryKey: SOURCES_KEY });
  const invalidateAttachments = () => {
    if (attachSource) {
      queryClient.invalidateQueries({
        queryKey: ["/api/sitespecific/bao/rate-sources", attachSource.id, "attachments"],
      });
    }
    invalidateSources();
  };

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setType("contract");
    setStartYmd("");
    setEmployerIds(new Set());
    setEmployerSearch("");
  };

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (source: BaoRateSourceWithDetails) => {
    setEditingId(source.id);
    setName(source.name);
    setType(source.type);
    setStartYmd(source.startYmd?.slice(0, 10) ?? "");
    setEmployerIds(new Set(source.employers.map((e) => e.id)));
    setEmployerSearch("");
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        type,
        startYmd,
        employerIds: Array.from(employerIds),
      };
      if (editingId) {
        return apiRequest("PATCH", `/api/sitespecific/bao/rate-sources/${editingId}`, payload);
      }
      return apiRequest("POST", "/api/sitespecific/bao/rate-sources", payload);
    },
    onSuccess: async () => {
      await invalidateSources();
      toast({ title: editingId ? "Source updated" : "Source created" });
      setFormOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sitespecific/bao/rate-sources/${id}`);
    },
    onSuccess: async () => {
      await invalidateSources();
      toast({ title: "Source deleted" });
      setDeleting(null);
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (fileId: string) => {
      return apiRequest(
        "DELETE",
        `/api/sitespecific/bao/rate-sources/${attachSource!.id}/attachments/${fileId}`,
      );
    },
    onSuccess: () => {
      invalidateAttachments();
      toast({ title: "Attachment deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !attachSource) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(
          `/api/sitespecific/bao/rate-sources/${attachSource.id}/attachments`,
          { method: "POST", body: formData, credentials: "include" },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || `Failed to upload ${file.name}`);
        }
      }
      invalidateAttachments();
      toast({ title: "Uploaded", description: "Attachment(s) uploaded." });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const filteredEmployers = useMemo(() => {
    const q = employerSearch.trim().toLowerCase();
    if (!q) return employers;
    return employers.filter((e) => e.name.toLowerCase().includes(q));
  }, [employers, employerSearch]);

  const formValid =
    name.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(startYmd) && employerIds.size > 0;

  const toggleEmployer = (id: string, checked: boolean) => {
    setEmployerIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="title-bao-rate-sources">
            BAO Benefit Rate Sources
          </h1>
          <p className="text-muted-foreground">
            Contracts and rate letters that document where employer rates come from. Status is
            calculated automatically — a source is superseded when a newer source takes effect for
            the same employer.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-source">
          <Plus className="h-4 w-4 mr-2" />
          New Source
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
          <CardDescription>All benefit rate sources, oldest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-center py-8 text-destructive" data-testid="text-sources-error">
              {(error as Error).message}
            </p>
          ) : sources.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground" data-testid="text-no-sources">
              No rate sources yet. Create one to start tracking where rates come from.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Employers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.id} data-testid={`row-source-${s.id}`}>
                    <TableCell className="font-medium" data-testid={`text-source-name-${s.id}`}>
                      {s.name}
                    </TableCell>
                    <TableCell data-testid={`text-source-type-${s.id}`}>
                      {TYPE_LABELS[s.type] ?? s.type}
                    </TableCell>
                    <TableCell data-testid={`text-source-start-${s.id}`}>
                      {formatYmd(s.startYmd)}
                    </TableCell>
                    <TableCell data-testid={`text-source-employers-${s.id}`}>
                      <div className="flex flex-wrap gap-1">
                        {s.employers.map((e) => (
                          <Badge
                            key={e.id}
                            variant={
                              s.activeForEmployerIds.includes(e.id) ? "default" : "secondary"
                            }
                            className="font-normal"
                          >
                            {e.name}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`status-source-${s.id}`}>
                      {s.isActive ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Superseded</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAttachSource(s)}
                        data-testid={`button-attachments-${s.id}`}
                      >
                        <Paperclip className="h-4 w-4 mr-1" />
                        {s.attachmentCount}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(s)}
                          data-testid={`button-edit-source-${s.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(s)}
                          data-testid={`button-delete-source-${s.id}`}
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

      {/* Create / edit dialog */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Rate Source" : "New Rate Source"}</DialogTitle>
            <DialogDescription>
              A source applies to one or more employers. Its start date determines which rate
              entries it supersedes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 2026–2029 CBA, Rate letter 3/2026"
                data-testid="input-source-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as BaoRateSourceType)}>
                  <SelectTrigger data-testid="select-source-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="rate_letter">Rate Letter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={startYmd}
                  onChange={(e) => setStartYmd(e.target.value)}
                  data-testid="input-source-start"
                />
              </div>
            </div>
            <div>
              <Label>Employers ({employerIds.size} selected)</Label>
              <Input
                placeholder="Search employers…"
                value={employerSearch}
                onChange={(e) => setEmployerSearch(e.target.value)}
                className="mt-1 mb-2"
                data-testid="input-source-employer-search"
              />
              <div className="border rounded-md max-h-48 overflow-y-auto p-2 space-y-1">
                {filteredEmployers.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-2">No employers found.</p>
                ) : (
                  filteredEmployers.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-center gap-2 p-1 rounded hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={employerIds.has(e.id)}
                        onCheckedChange={(checked) => toggleEmployer(e.id, checked === true)}
                        data-testid={`checkbox-source-employer-${e.id}`}
                      />
                      <span className="text-sm">{e.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFormOpen(false)}
              data-testid="button-cancel-source"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!formValid || saveMutation.isPending}
              data-testid="button-save-source"
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? "Save Changes" : "Create Source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attachments dialog */}
      <Dialog open={!!attachSource} onOpenChange={(open) => !open && setAttachSource(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Attachments</DialogTitle>
            <DialogDescription>
              {attachSource?.name} — files are shared across all of this source's employers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <input
                type="file"
                id="bao-source-file-input"
                className="hidden"
                multiple
                accept="image/*,application/pdf"
                onChange={(e) => {
                  handleUpload(e.target.files);
                  e.target.value = "";
                }}
                data-testid="input-attachment-file"
              />
              <Button
                variant="outline"
                disabled={uploading}
                onClick={() => document.getElementById("bao-source-file-input")?.click()}
                data-testid="button-upload-attachment"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Upload (PDF or image)
              </Button>
            </div>

            {attachmentsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-attachments">
                No files attached yet.
              </p>
            ) : (
              <div className="space-y-2">
                {attachments.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-2 border rounded-md p-2"
                    data-testid={`row-attachment-${f.id}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-attachment-name-${f.id}`}>
                        {f.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatSize(f.size)}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        asChild
                        data-testid={`button-download-attachment-${f.id}`}
                      >
                        <a
                          href={`/api/sitespecific/bao/rate-sources/${attachSource?.id}/attachments/${f.id}/download`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteAttachmentMutation.mutate(f.id)}
                        disabled={deleteAttachmentMutation.isPending}
                        data-testid={`button-delete-attachment-${f.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Rate Source</DialogTitle>
            <DialogDescription>
              Delete "{deleting?.name}"? Its attachments are deleted too. Sources that still have
              rate entries attached cannot be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              data-testid="button-cancel-delete-source"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-source"
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
