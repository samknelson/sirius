import { useEffect, useRef, useState } from "react";
import { useParams, Link, useLocation, useSearch } from "wouter";
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
  AlertTriangle,
  FolderOpen,
  Folder,
  FolderPlus,
  ArrowLeft,
  ChevronRight,
  Home,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface FileSystemInfo {
  id: string;
  name: string;
  description: string | null;
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
  directories?: string[];
  capabilities?: { mkdir: boolean; rmdir: boolean };
  cursor?: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function baseName(path: string): string {
  return path.split("/").pop() || path;
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

export default function FileBrowserDetailPage() {
  const params = useParams<{ id: string }>();
  const fsId = params.id ?? "";
  usePageTitle("File Browser");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();

  // Current directory comes from the URL so it survives refresh.
  const dir = new URLSearchParams(search).get("dir")?.replace(/^\/+|\/+$/g, "") ?? "";

  const navigateToDir = (nextDir: string) => {
    const base = `/admin/file-browser/${encodeURIComponent(fsId)}`;
    setLocation(nextDir ? `${base}?dir=${encodeURIComponent(nextDir)}` : base);
  };

  // Accumulated pages: entries so far + the cursor to load the next page.
  const [pages, setPages] = useState<BrowseEntry[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<{ mkdir: boolean; rmdir: boolean }>({
    mkdir: false,
    rmdir: false,
  });
  const [cursor, setCursor] = useState<string | null>(null);
  const [browseStatus, setBrowseStatus] = useState<BrowsePage["status"] | null>(null);
  const [browseMessage, setBrowseMessage] = useState<string | undefined>();
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPath, setUploadPath] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrowseEntry | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const { data: filesystems = [], isLoading: isLoadingFs } = useQuery<FileSystemInfo[]>({
    queryKey: ["/api/admin/filesystems"],
  });

  const selectedFs = filesystems.find((f) => f.id === fsId);

  const browse = async (opts: { reset: boolean; nextCursor?: string | null }) => {
    if (!fsId) return;
    setIsBrowsing(true);
    try {
      const params = new URLSearchParams();
      if (dir) params.set("dir", dir);
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
      if (opts.reset) setDirectories(page.directories ?? []);
      if (page.capabilities) setCapabilities(page.capabilities);
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

  // Browse on mount and whenever the filesystem id or directory changes.
  useEffect(() => {
    setPages([]);
    setDirectories([]);
    setCursor(null);
    setBrowseStatus(null);
    setBrowseMessage(undefined);
    if (!fsId) return;
    void browse({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsId, dir]);

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

  const mkdirMutation = useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(`/api/admin/filesystems/${encodeURIComponent(fsId)}/mkdir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Folder creation failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Folder created." });
      setNewFolderOpen(false);
      setNewFolderName("");
      refresh();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rmdirMutation = useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(
        `/api/admin/filesystems/${encodeURIComponent(fsId)}/directory?path=${encodeURIComponent(path)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Folder removal failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Removed", description: "Folder removed." });
      setDeleteFolderTarget(null);
      refresh();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setDeleteFolderTarget(null);
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

  const crumbs = dir ? dir.split("/") : [];

  if (isLoadingFs) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (!selectedFs) {
    return (
      <div className="space-y-6">
        <Link href="/admin/file-browser">
          <Button variant="ghost" size="sm" data-testid="link-back-to-filesystems">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All filesystems
          </Button>
        </Link>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-muted-foreground" data-testid="text-fs-not-found">
                No filesystem with id "{fsId}" was found. It is neither configured in the
                FILESYSTEMS environment variable nor referenced by any file records.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/file-browser">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2" data-testid="link-back-to-filesystems">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All filesystems
          </Button>
        </Link>
        <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="text-page-title">
          File Browser: {selectedFs.name}
        </h1>
        <p className="text-muted-foreground mt-2" data-testid="text-fs-description">
          {selectedFs.description ||
            (selectedFs.configured
              ? `${selectedFs.provider === "replit" ? "Replit object storage" : selectedFs.provider === "s3" ? "S3" : "Local"} filesystem (${selectedFs.access})`
              : "This filesystem is referenced by file records but is not configured.")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground" data-testid="text-fs-details">
        <Badge variant="outline">id: {selectedFs.id}</Badge>
        {selectedFs.configured ? (
          <>
            <Badge variant="outline">provider: {selectedFs.provider}</Badge>
            <Badge variant="outline">access: {selectedFs.access}</Badge>
          </>
        ) : (
          <Badge variant="destructive">not configured</Badge>
        )}
      </div>

      {selectedFs.configured && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={refresh} disabled={isBrowsing} data-testid="button-refresh">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setUploadOpen(true)} data-testid="button-upload">
            <Upload className="mr-2 h-4 w-4" />
            Upload
          </Button>
          {capabilities.mkdir && (
            <Button variant="outline" onClick={() => setNewFolderOpen(true)} data-testid="button-new-folder">
              <FolderPlus className="mr-2 h-4 w-4" />
              New folder
            </Button>
          )}
        </div>
      )}

      {selectedFs.configured && browseStatus === "ok" && (
        <nav
          className="flex flex-wrap items-center gap-1 text-sm font-mono"
          aria-label="Breadcrumb"
          data-testid="breadcrumb-folders"
        >
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            onClick={() => navigateToDir("")}
            disabled={!dir}
            data-testid="breadcrumb-root"
          >
            <Home className="h-4 w-4" />
          </Button>
          {crumbs.map((segment, i) => {
            const target = crumbs.slice(0, i + 1).join("/");
            const isLast = i === crumbs.length - 1;
            return (
              <span key={target} className="flex items-center gap-1">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                {isLast ? (
                  <span className="px-1 font-medium" data-testid={`breadcrumb-current`}>
                    {segment}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2"
                    onClick={() => navigateToDir(target)}
                    data-testid={`breadcrumb-segment-${target}`}
                  >
                    {segment}
                  </Button>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {browseStatus && browseStatus !== "ok" && (
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

      {selectedFs.configured && browseStatus === "ok" && (
        <>
          {pages.length === 0 && directories.length === 0 && !dir && !isBrowsing ? (
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <FolderOpen className="h-8 w-8" />
                  <p data-testid="text-empty-listing">This filesystem is empty.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table data-testid="table-files">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Modified</TableHead>
                    <TableHead>Record</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dir && (
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => navigateToDir(crumbs.slice(0, -1).join("/"))}
                      data-testid="row-folder-up"
                    >
                      <TableCell className="font-mono text-sm" colSpan={4}>
                        <span className="flex items-center gap-2">
                          <Folder className="h-4 w-4 text-muted-foreground" />
                          ..
                        </span>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  {directories.map((folder) => (
                    <TableRow
                      key={`dir:${folder}`}
                      className="cursor-pointer"
                      onClick={() => navigateToDir(folder)}
                      data-testid={`row-folder-${folder}`}
                    >
                      <TableCell className="font-mono text-sm max-w-md truncate" title={folder}>
                        <span className="flex items-center gap-2">
                          <Folder className="h-4 w-4 text-blue-500" />
                          {baseName(folder)}/
                        </span>
                      </TableCell>
                      <TableCell>—</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell className="text-right">
                        {capabilities.rmdir && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteFolderTarget(folder);
                            }}
                            data-testid={`button-delete-folder-${folder}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {pages.map((entry) => (
                    <TableRow key={entry.path} data-testid={`row-file-${entry.path}`}>
                      <TableCell className="font-mono text-sm max-w-md truncate" title={entry.path}>
                        {baseName(entry.path)}
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
                  {pages.length === 0 && directories.length === 0 && dir && !isBrowsing && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground" data-testid="text-empty-folder">
                        This folder is empty.
                      </TableCell>
                    </TableRow>
                  )}
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

      {isBrowsing && pages.length === 0 && directories.length === 0 && (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
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
              Upload a file to {selectedFs.name}
              {dir ? (
                <>
                  {" "}
                  in <span className="font-mono">{dir}/</span>
                </>
              ) : null}
              . Leave the name empty to use the file's own name — uploading to an existing
              name replaces that file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="upload-path">File name (optional)</Label>
              <Input
                id="upload-path"
                placeholder="name.ext"
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
                const name = uploadPath.trim().replace(/^\/+/, "") || file.name;
                const path = dir ? `${dir}/${name}` : name;
                uploadMutation.mutate({ file, path });
              }}
              data-testid="button-confirm-upload"
            >
              {uploadMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Create a folder in{" "}
              <span className="font-mono">{dir ? `${dir}/` : "the root of"}</span>{" "}
              {selectedFs.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="new-folder-name">Folder name</Label>
            <Input
              id="new-folder-name"
              placeholder="e.g. reports"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newFolderName.trim()) {
                  const name = newFolderName.trim().replace(/^\/+|\/+$/g, "");
                  mkdirMutation.mutate(dir ? `${dir}/${name}` : name);
                }
              }}
              data-testid="input-new-folder-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)} data-testid="button-cancel-new-folder">
              Cancel
            </Button>
            <Button
              disabled={mkdirMutation.isPending || !newFolderName.trim()}
              onClick={() => {
                const name = newFolderName.trim().replace(/^\/+|\/+$/g, "");
                if (!name || name.includes("/") || name === "." || name === "..") {
                  toast({
                    title: "Error",
                    description: "Enter a folder name without slashes.",
                    variant: "destructive",
                  });
                  return;
                }
                mkdirMutation.mutate(dir ? `${dir}/${name}` : name);
              }}
              data-testid="button-confirm-new-folder"
            >
              {mkdirMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
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

      <AlertDialog
        open={!!deleteFolderTarget}
        onOpenChange={(open) => !open && setDeleteFolderTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the folder <span className="font-mono">{deleteFolderTarget}</span>.
              Folders can only be removed when they are empty.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-folder">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFolderTarget && rmdirMutation.mutate(deleteFolderTarget)}
              data-testid="button-confirm-delete-folder"
            >
              {rmdirMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
