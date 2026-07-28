import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Upload, Download, Pencil, Trash2, FileText, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface EntityFileItem {
  id: string;
  entityId: string;
  fileId: string;
  name: string;
  data: unknown;
  file: {
    id: string;
    fileName: string;
    mimeType: string | null;
    size: number;
    uploadedAt: string;
    status: string;
  };
}

interface EntityFilesResponse {
  configured: boolean;
  message: string | null;
  allowed: string[] | null;
  files: EntityFileItem[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/**
 * Reusable attachment manager for the generic entity-files framework.
 * Renders the file list plus upload / rename / download / delete for one
 * entity of one registered context.
 */
export function EntityFileManager({
  context,
  entityId,
}: {
  context: string;
  entityId: string;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EntityFileItem | null>(null);

  const listKey = ["/api/entity-files", context, entityId];

  const { data, isLoading, isError } = useQuery<EntityFilesResponse>({
    queryKey: listKey,
    enabled: !!entityId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/entity-files/${context}/${entityId}`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "File uploaded" });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      apiRequest("PATCH", `/api/entity-files/${context}/${entityId}/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      setEditingId(null);
      toast({ title: "File renamed" });
    },
    onError: (error) => {
      toast({
        title: "Rename failed",
        description: getApiErrorMessage(error, "Request failed"),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/entity-files/${context}/${entityId}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      setDeleteTarget(null);
      toast({ title: "File deleted" });
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: getApiErrorMessage(error, "Request failed"),
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-destructive" data-testid="text-files-error">
        Failed to load files.
      </p>
    );
  }

  return (
    <Card data-testid="card-entity-files">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Files</CardTitle>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            data-testid="input-file-upload"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            disabled={!data.configured || uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-upload-file"
          >
            <Upload className="h-4 w-4 mr-2" />
            {uploadMutation.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!data.configured && (
          <p className="text-muted-foreground text-sm mb-4" data-testid="text-files-unconfigured">
            {data.message || "File attachments are not configured for this area."}
          </p>
        )}
        {data.allowed && data.allowed.length > 0 && (
          <p className="text-muted-foreground text-xs mb-4" data-testid="text-files-allowed">
            Allowed file types: {data.allowed.join(", ")}
          </p>
        )}
        {data.files.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-files-empty">
            No files attached.
          </p>
        ) : (
          <div className="divide-y">
            {data.files.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 py-3"
                data-testid={`row-entity-file-${item.id}`}
              >
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  {editingId === item.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8"
                        data-testid={`input-rename-${item.id}`}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={!editName.trim() || renameMutation.isPending}
                        onClick={() =>
                          renameMutation.mutate({ id: item.id, name: editName.trim() })
                        }
                        data-testid={`button-rename-save-${item.id}`}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setEditingId(null)}
                        data-testid={`button-rename-cancel-${item.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="font-medium truncate" data-testid={`text-file-name-${item.id}`}>
                        {item.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.file.fileName} · {formatSize(item.file.size)} ·{" "}
                        {formatDate(item.file.uploadedAt)}
                        {item.file.status !== "live" ? ` · ${item.file.status}` : ""}
                      </p>
                    </>
                  )}
                </div>
                {editingId !== item.id && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      asChild
                      data-testid={`button-download-${item.id}`}
                    >
                      <a
                        href={`/api/entity-files/${context}/${entityId}/${item.id}/download?download=1`}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditName(item.name);
                      }}
                      data-testid={`button-rename-${item.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setDeleteTarget(item)}
                      data-testid={`button-delete-${item.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes "{deleteTarget?.name}" and its stored file. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
