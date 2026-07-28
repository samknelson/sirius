import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Loader2,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  Search,
  AlertTriangle,
  FolderOpen,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface FileSystemInfo {
  id: string;
  name: string;
  access: string | null;
  provider: string | null;
  configured: boolean;
}

interface BrowseEntry {
  path: string;
  size: number;
  lastModified: string | null;
  fileId: string | null;
  fileName: string | null;
  rowStatus: string | null;
  orphan: boolean;
  objectMissing?: boolean;
}

interface BrowsePage {
  status: "ok" | "unconfigured" | "unsupported" | "inaccessible";
  message?: string;
  entries: BrowseEntry[];
  cursor?: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StatusBadge({ entry }: { entry: BrowseEntry }) {
  if (entry.orphan) {
    return (
      <Badge variant="destructive" data-testid={`badge-status-${entry.path}`}>
        No record
      </Badge>
    );
  }
  if (entry.rowStatus === "missing") {
    return (
      <Badge variant="destructive" data-testid={`badge-status-${entry.path}`}>
        Missing
      </Badge>
    );
  }
  if (entry.rowStatus === "pending_delete") {
    return (
      <Badge variant="outline" className="text-amber-600 border-amber-400" data-testid={`badge-status-${entry.path}`}>
        Pending delete
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" data-testid={`badge-status-${entry.path}`}>
      {entry.rowStatus === "live" ? "Live" : entry.rowStatus}
    </Badge>
  );
}

export default function FileBrowserPage() {
  usePageTitle("File Browser");
  const { toast } = useToast();

  const [fsId, setFsId] = useState<string>("");
  const [prefixInput, setPrefixInput] = useState("");
  const [prefix, setPrefix] = useState("");
  // Accumulated pages: entries so far + the cursor to load the next page.
  const [pages, setPages] = useState<BrowseEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [browseStatus, setBrowseStatus] = useState<BrowsePage["status"] | null>(null);
  const [browseMessage, setBrowseMessage] = useState<string | undefined>();
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPath, setUploadPath] = useState("");
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrowseEntry | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const { data: filesystems = [], isLoading: isLoadingFs } = useQuery<FileSystemInfo[]>({
    queryKey: ["/api/admin/filesystems"],
  });

  const selectedFs = filesystems.find((f) => f.id === fsId);

  const browse = async (opts: { reset: boolean; nextCursor?: string | null; usePrefix?: string }) => {
    if (!fsId) return;
    setIsBrowsing(true);
    try {
      const params = new URLSearchParams();
      const effectivePrefix = opts.usePrefix !== undefined ? opts.usePrefix : prefix;
      if (effectivePrefix) params.set("prefix", effectivePrefix);
      if (!opts.reset && opts.nextCursor) params.set("cursor", opts.nextCursor);
      params.set("limit", "50");
      const res = await fetch(`/api/admin/filesystems/${encodeURIComponent(fsId)}/browse?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Listing failed (${res.status})`);
      const page: BrowsePage = await res.json();
      setBrowseStatus(page.status);
      setBrowseMessage(page.message);
      setPages((prev) => (opts.reset ? page.entries : [...prev, ...page.entries]));
      setCursor(page.cursor ?? null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to list files",
        variant: "destructive",
      });
    } finally {
      setIsBrowsing(false);
    }
  };

  const selectFilesystem = (id: string) => {
    setFsId(id);
    setPages([]);
    setCursor(null);
    setBrowseStatus(null);
    setBrowseMessage(undefined);
    setPrefix("");
    setPrefixInput("");
    // Browse immediately for the newly selected filesystem.
    setTimeout(() => void browseFor(id, ""), 0);
  };

  // Direct-parameter variant so selection doesn't race the fsId state update.
  const browseFor = async (id: string, effectivePrefix: string) => {
    setIsBrowsing(true);
    try {
      const params = new URLSearchParams();
      if (effectivePrefix) params.set("prefix", effectivePrefix);
      params.set("limit", "50");
      const res = await fetch(`/api/admin/filesystems/${encodeURIComponent(id)}/browse?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Listing failed (${res.status})`);
      const page: BrowsePage = await res.json();
      setBrowseStatus(page.status);
      setBrowseMessage(page.message);
      setPages(page.entries);
      setCursor(page.cursor ?? null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to list files",
        variant: "destructive",
      });
    } finally {
      setIsBrowsing(false);
    }
  };

  const applyPrefix = () => {
    setPrefix(prefixInput);
    void browse({ reset: true, usePrefix: prefixInput });
  };

  const refresh = () => void browse({ reset: true });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, path }: { file: File; path?: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (path) form.append("path", path);
      const res = await fetch(`/api/admin/filesystems/${encodeURIComponent(fsId)}/upload`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "File uploaded." });
      setUploadOpen(false);
      setUploadPath("");
      setReplaceTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/filesystems"] });
      refresh();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(
        `/api/admin/filesystems/${encodeURIComponent(fsId)}/object?path=${encodeURIComponent(path)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Delete failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (data: { message?: string }) => {
      toast({ title: "Deleted", description: data.message || "File deleted." });
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/filesystems"] });
      refresh();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const download = (path: string) => {
    window.open(
      `/api/admin/filesystems/${encodeURIComponent(fsId)}/download?path=${encodeURIComponent(path)}`,
      "_blank",
    );
  };

  const startReplace = (path: string) => {
    setReplaceTarget(path);
    replaceInputRef.current?.click();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="text-page-title">
          File Browser
        </h1>
        <p className="text-muted-foreground mt-2">
          Raw view of the configured filesystems. Shows what is actually on the
          filesystem; files without a database record are flagged.
        </p>
      </div>

      {isLoadingFs ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
        </div>
      ) : filesystems.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground" data-testid="text-no-filesystems">
              No filesystems are configured. An operator must define them in the
              FILESYSTEMS environment variable.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label>Filesystem</Label>
              <Select value={fsId} onValueChange={selectFilesystem}>
                <SelectTrigger className="w-72" data-testid="select-filesystem">
                  <SelectValue placeholder="Select a filesystem…" />
                </SelectTrigger>
                <SelectContent>
                  {filesystems.map((fs) => (
                    <SelectItem key={fs.id} value={fs.id} data-testid={`option-fs-${fs.id}`}>
                      {fs.name} ({fs.id})
                      {!fs.configured ? " — not configured" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedFs?.configured && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="prefix">Folder / prefix</Label>
                  <div className="flex gap-2">
                    <Input
                      id="prefix"
                      className="w-64"
                      placeholder="e.g. reports/2026/"
                      value={prefixInput}
                      onChange={(e) => setPrefixInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && applyPrefix()}
                      data-testid="input-prefix"
                    />
                    <Button variant="outline" onClick={applyPrefix} data-testid="button-apply-prefix">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button variant="outline" onClick={refresh} disabled={isBrowsing} data-testid="button-refresh">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
                <Button onClick={() => setUploadOpen(true)} data-testid="button-upload">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </Button>
              </>
            )}
          </div>

          {selectedFs && (
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground" data-testid="text-fs-details">
              {selectedFs.configured ? (
                <>
                  <Badge variant="outline">provider: {selectedFs.provider}</Badge>
                  <Badge variant="outline">access: {selectedFs.access}</Badge>
                </>
              ) : (
                <Badge variant="destructive">not configured</Badge>
              )}
            </div>
          )}

          {selectedFs && browseStatus && browseStatus !== "ok" && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground" data-testid="text-browse-status">
                    {browseMessage || "This filesystem cannot be browsed right now."}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {selectedFs?.configured && browseStatus === "ok" && (
            <>
              {pages.length === 0 && !isBrowsing ? (
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FolderOpen className="h-8 w-8" />
                      <p data-testid="text-empty-listing">
                        {prefix ? `No files under "${prefix}".` : "This filesystem is empty."}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="rounded-md border">
                  <Table data-testid="table-files">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Path</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Modified</TableHead>
                        <TableHead>Record</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pages.map((entry) => (
                        <TableRow key={entry.path} data-testid={`row-file-${entry.path}`}>
                          <TableCell className="font-mono text-sm max-w-md truncate" title={entry.path}>
                            {entry.path}
                          </TableCell>
                          <TableCell>{formatSize(entry.size)}</TableCell>
                          <TableCell>
                            {entry.lastModified ? new Date(entry.lastModified).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge entry={entry} />
                          </TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={entry.objectMissing}
                              onClick={() => download(entry.path)}
                              data-testid={`button-download-${entry.path}`}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startReplace(entry.path)}
                              data-testid={`button-replace-${entry.path}`}
                            >
                              <Upload className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(entry)}
                              data-testid={`button-delete-${entry.path}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {cursor && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    disabled={isBrowsing}
                    onClick={() => void browse({ reset: false, nextCursor: cursor })}
                    data-testid="button-load-more"
                  >
                    {isBrowsing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}

          {isBrowsing && pages.length === 0 && (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
        </>
      )}

      {/* Hidden input used by the per-row Replace action. */}
      <input
        ref={replaceInputRef}
        type="file"
        className="hidden"
        data-testid="input-replace-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && replaceTarget) {
            uploadMutation.mutate({ file, path: replaceTarget });
          }
          e.target.value = "";
        }}
      />

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload file</DialogTitle>
            <DialogDescription>
              Upload a file to {selectedFs?.name}. Leave the path empty to auto-generate one, or
              set a path (e.g. <span className="font-mono">reports/summary.pdf</span>) — uploading
              to an existing path replaces that file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="upload-path">Path (optional)</Label>
              <Input
                id="upload-path"
                placeholder="folder/name.ext"
                value={uploadPath}
                onChange={(e) => setUploadPath(e.target.value)}
                data-testid="input-upload-path"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="upload-file">File</Label>
              <Input id="upload-file" type="file" ref={fileInputRef} data-testid="input-upload-file" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} data-testid="button-cancel-upload">
              Cancel
            </Button>
            <Button
              disabled={uploadMutation.isPending}
              onClick={() => {
                const file = fileInputRef.current?.files?.[0];
                if (!file) {
                  toast({ title: "Error", description: "Choose a file first.", variant: "destructive" });
                  return;
                }
                uploadMutation.mutate({ file, path: uploadPath.trim() || undefined });
              }}
              data-testid="button-confirm-upload"
            >
              {uploadMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-mono">{deleteTarget?.path}</span>
              {deleteTarget && !deleteTarget.orphan
                ? " and its database record."
                : ". It has no database record."}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.path)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
