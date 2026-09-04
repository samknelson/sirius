import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Upload, Download, Pencil, Trash2, FileText, Check, X, NotebookPen } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALL_TYPES,
  TypeFilter,
  buildTypeFilterChoices,
  typeFilterMatches,
  type TypeFilterChoice,
} from "@/components/type-filter";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/** Sentinel for the "No type" choice — Select cannot hold an empty value. */
const NO_TYPE = "__none__";

interface FileTypeOption {
  id: string;
  name: string;
  description: string | null;
  data: { contextIds?: string[] } | null;
}

export interface EntityFileItem {
  id: string;
  entityId: string;
  fileId: string;
  name: string;
  typeId: string | null;
  typeName: string | null;
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
  const [metaTarget, setMetaTarget] = useState<EntityFileItem | null>(null);
  const [metaDescription, setMetaDescription] = useState("");
  // The chosen type is tracked as "what the user picked", not as seeded
  // state: the type list can arrive AFTER this dialog opens, and a seed taken
  // before it arrived would silently become a request to clear the type.
  const [metaTypeId, setMetaTypeId] = useState<string>(NO_TYPE);
  const [metaTypeTouched, setMetaTypeTouched] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadTypeId, setUploadTypeId] = useState<string>(NO_TYPE);
  const [typeFilter, setTypeFilter] = useState<TypeFilterChoice>(ALL_TYPES);

  const listKey = ["/api/entity-files", context, entityId];

  const { data, isLoading, isError } = useQuery<EntityFilesResponse>({
    queryKey: listKey,
    enabled: !!entityId,
  });

  const {
    data: allFileTypes = [],
    isLoading: typesLoading,
    isError: typesError,
  } = useQuery<FileTypeOption[]>({
    queryKey: ["/api/options/file-type"],
  });

  // Only types that declare this area are offerable; the server enforces the
  // same pairing on save.
  const fileTypes = useMemo(
    () => allFileTypes.filter((t) => (t.data?.contextIds ?? []).includes(context)),
    [allFileTypes, context],
  );

  // An unanswered query is NOT "this area has no types": treating it as one
  // would let a description edit submit "no type" and wipe a type the panel
  // simply had not loaded yet. Nothing offers or submits a type until the
  // list has actually arrived.
  const typesResolved = !typesLoading && !typesError;
  const canChooseType = typesResolved && fileTypes.length > 0;

  // Until the user picks something, the control shows the attachment's stored
  // type — but only if this area still offers it. A type that no longer
  // applies shows as "No type", which is what saving would make it, and the
  // dialog says so.
  const metaTypeValue = metaTypeTouched
    ? metaTypeId
    : metaTarget?.typeId && fileTypes.some((t) => t.id === metaTarget.typeId)
      ? metaTarget.typeId
      : NO_TYPE;

  // A view over the attachments already loaded: the filter narrows what is
  // listed, it never changes what was fetched.
  const allFiles = data?.files ?? [];
  const filterChoices = useMemo(
    () => buildTypeFilterChoices(allFiles, typeFilter),
    [allFiles, typeFilter],
  );
  const visibleFiles = useMemo(
    () => allFiles.filter((item) => typeFilterMatches(typeFilter, item)),
    [allFiles, typeFilter],
  );

  const uploadMutation = useMutation({
    mutationFn: async ({ file, typeId }: { file: File; typeId: string | null }) => {
      const formData = new FormData();
      formData.append("file", file);
      if (typeId) formData.append("typeId", typeId);
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
      setPendingFile(null);
      setUploadTypeId(NO_TYPE);
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

  const metadataMutation = useMutation({
    mutationFn: async ({
      id,
      data,
      typeId,
    }: {
      id: string;
      data: Record<string, unknown>;
      typeId?: string | null;
    }) =>
      apiRequest("PATCH", `/api/entity-files/${context}/${entityId}/${id}`, {
        data,
        // Omitted where this screen offered no type control: PATCH leaves an
        // absent field alone, and resending a type this area no longer offers
        // would be refused, taking the description edit down with it.
        ...(typeId === undefined ? {} : { typeId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      setMetaTarget(null);
      toast({ title: "File details updated" });
    },
    onError: (error) => {
      toast({
        title: "Update failed",
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
              if (file) {
                // With no types to choose from there is nothing to ask, so the
                // button keeps behaving exactly as it did before the list
                // existed: pick a file, it uploads. Still loading counts as
                // "might have types" — the dialog waits for the answer.
                if (typesResolved && fileTypes.length === 0) {
                  uploadMutation.mutate({ file, typeId: null });
                } else {
                  setUploadTypeId(NO_TYPE);
                  setPendingFile(file);
                }
              }
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
        <TypeFilter
          id="entity-file-type-filter"
          value={typeFilter}
          onChange={setTypeFilter}
          choices={filterChoices}
          shown={visibleFiles.length}
          total={data.files.length}
        />

        {data.files.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-files-empty">
            No files attached.
          </p>
        ) : visibleFiles.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-files-empty-match">
            No files of this type. {data.files.length} file
            {data.files.length === 1 ? " is" : "s are"} hidden by the filter.
          </p>
        ) : (
          <div className="divide-y">
            {visibleFiles.map((item) => (
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
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="font-medium truncate" data-testid={`text-file-name-${item.id}`}>
                          {item.name}
                        </p>
                        {item.typeName && (
                          <Badge variant="secondary" data-testid={`badge-file-type-${item.id}`}>
                            {item.typeName}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.file.fileName} · {formatSize(item.file.size)} ·{" "}
                        {formatDate(item.file.uploadedAt)}
                        {item.file.status !== "live" ? ` · ${item.file.status}` : ""}
                      </p>
                      {typeof (item.data as any)?.description === "string" &&
                        (item.data as any).description.trim() !== "" && (
                          <p
                            className="text-xs text-muted-foreground truncate italic"
                            data-testid={`text-file-description-${item.id}`}
                          >
                            {(item.data as any).description}
                          </p>
                        )}
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
                      <a href={`/api/files/${item.file.id}/download?download=1`}>
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
                      className="h-8 w-8"
                      onClick={() => {
                        setMetaTarget(item);
                        const desc = (item.data as any)?.description;
                        setMetaDescription(typeof desc === "string" ? desc : "");
                        setMetaTypeId(NO_TYPE);
                        setMetaTypeTouched(false);
                      }}
                      data-testid={`button-edit-metadata-${item.id}`}
                    >
                      <NotebookPen className="h-4 w-4" />
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

      {/* Asked only where there is something to ask: an area with no file
          types uploads on file-pick, with no dialog in the way. */}
      <Dialog open={!!pendingFile} onOpenChange={(open) => !open && setPendingFile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload file</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground truncate" data-testid="text-upload-file-name">
              {pendingFile?.name}
            </p>
            <div className="space-y-2">
              <Label htmlFor="entity-file-upload-type">Type</Label>
              {typesLoading && (
                <p className="text-sm text-muted-foreground" data-testid="text-upload-types-loading">
                  Loading file types…
                </p>
              )}
              {typesError && (
                <p className="text-sm text-destructive" data-testid="text-upload-types-error">
                  Could not load file types. You can still upload the file without one.
                </p>
              )}
              <Select value={uploadTypeId} onValueChange={setUploadTypeId} disabled={!canChooseType}>
                <SelectTrigger id="entity-file-upload-type" data-testid="select-upload-file-type">
                  <SelectValue placeholder="No type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TYPE} data-testid="option-upload-file-type-none">
                    No type
                  </SelectItem>
                  {fileTypes.map((type) => (
                    <SelectItem
                      key={type.id}
                      value={type.id}
                      data-testid={`option-upload-file-type-${type.id}`}
                    >
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingFile(null)}
              data-testid="button-upload-cancel"
            >
              Cancel
            </Button>
            <Button
              disabled={uploadMutation.isPending || typesLoading}
              onClick={() => {
                if (!pendingFile) return;
                uploadMutation.mutate({
                  file: pendingFile,
                  typeId: uploadTypeId === NO_TYPE ? null : uploadTypeId,
                });
              }}
              data-testid="button-upload-confirm"
            >
              {uploadMutation.isPending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!metaTarget} onOpenChange={(open) => !open && setMetaTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>File details</DialogTitle>
          </DialogHeader>
          {canChooseType && (
            <div className="space-y-2">
              <Label htmlFor="entity-file-type">Type</Label>
              <Select
                value={metaTypeValue}
                onValueChange={(value) => {
                  setMetaTypeId(value);
                  setMetaTypeTouched(true);
                }}
              >
                <SelectTrigger id="entity-file-type" data-testid="select-file-type">
                  <SelectValue placeholder="No type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TYPE} data-testid="option-file-type-none">
                    No type
                  </SelectItem>
                  {fileTypes.map((type) => (
                    <SelectItem
                      key={type.id}
                      value={type.id}
                      data-testid={`option-file-type-${type.id}`}
                    >
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* A type the file already carries but this area no longer
                  offers stays visible on the row; saving here would clear it. */}
              {metaTarget?.typeId &&
                !fileTypes.some((t) => t.id === metaTarget.typeId) && (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="text-file-type-unavailable"
                  >
                    Its current type ({metaTarget.typeName ?? "unknown"}) no longer applies to this
                    record type. Saving will clear it.
                  </p>
                )}
            </div>
          )}
          {!canChooseType && metaTarget?.typeName && (
            <p className="text-sm text-muted-foreground" data-testid="text-file-type-kept">
              Type: {metaTarget.typeName} —{" "}
              {typesLoading
                ? "still loading the file types, so this one is left as it is."
                : typesError
                  ? "the file types could not be loaded, so this one is left as it is."
                  : "no file types apply to this record type, so this one is left as it is."}
            </p>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="entity-file-description">
              Description
            </label>
            <Textarea
              id="entity-file-description"
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              placeholder="Optional notes about this file"
              rows={4}
              data-testid="input-file-description"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMetaTarget(null)} data-testid="button-metadata-cancel">
              Cancel
            </Button>
            <Button
              disabled={metadataMutation.isPending}
              onClick={() => {
                if (!metaTarget) return;
                const existing =
                  metaTarget.data && typeof metaTarget.data === "object"
                    ? (metaTarget.data as Record<string, unknown>)
                    : {};
                metadataMutation.mutate({
                  id: metaTarget.id,
                  data: { ...existing, description: metaDescription.trim() },
                  ...(canChooseType
                    ? { typeId: metaTypeValue === NO_TYPE ? null : metaTypeValue }
                    : {}),
                });
              }}
              data-testid="button-metadata-save"
            >
              {metadataMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
