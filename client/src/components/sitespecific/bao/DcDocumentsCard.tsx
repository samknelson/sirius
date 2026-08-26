import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, FileUp, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DC_DOC_TYPE_LABELS } from "./dc-shared";
import { BAO_DC_DOCUMENT_TYPES } from "@shared/schema";

type EntityFileRecord = {
  id: string;
  fileId: string;
  name: string;
  data: {
    docType?: string;
    uploadedByUserId?: string;
    supersededAt?: string | null;
    supersededByUserId?: string | null;
  } | null;
  file: { id: string; fileName: string; uploadedAt?: string | null } | null;
};

type ListResponse = {
  configured: boolean;
  message: string | null;
  files: EntityFileRecord[];
};

/**
 * Case documents: uploader + type on every row, supersede (staff) but never
 * delete, multiple uploads consolidated under the case. Members can upload
 * to their own case; only staff can supersede or reclassify.
 */
export function DcDocumentsCard({
  caseId,
  canSupersede,
  canSetType,
  onEvidenceChange,
}: {
  caseId: string;
  canSupersede: boolean;
  canSetType: boolean;
  onEvidenceChange?: () => void;
}) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadDocType, setUploadDocType] = useState<string>("other");
  const listKey = ["/api/entity-files", "bao-dc-case", caseId];

  const { data, isLoading } = useQuery<ListResponse>({ queryKey: listKey });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: listKey });
    queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/dc/cases", caseId] });
    onEvidenceChange?.();
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/entity-files/bao-dc-case/${caseId}`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Upload failed");
      }
      const record: EntityFileRecord = await res.json();
      // Staff classify right after upload (server default is "other").
      // Members cannot classify — an MSR reviews and sets the type.
      if (canSetType && uploadDocType !== "other") {
        await apiRequest(
          "PATCH",
          `/api/sitespecific/bao/dc/cases/${caseId}/documents/${record.id}`,
          { docType: uploadDocType },
        );
      }
      return record;
    },
    onSuccess: () => {
      toast({ title: "Document uploaded" });
      refresh();
    },
    onError: (err) =>
      toast({
        title: "Upload failed",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  const setType = useMutation({
    mutationFn: async ({ id, docType }: { id: string; docType: string }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/sitespecific/bao/dc/cases/${caseId}/documents/${id}`,
        { docType },
      );
      return res.json() as Promise<{ bounced?: boolean }>;
    },
    onSuccess: (result) => {
      if (result?.bounced) {
        toast({
          title: "Document type updated",
          description: "The case no longer passes readiness and was returned to draft.",
        });
      }
      refresh();
    },
    onError: (err) =>
      toast({
        title: "Could not update document type",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  const supersede = useMutation({
    mutationFn: (documentId: string) =>
      apiRequest(
        "POST",
        `/api/sitespecific/bao/dc/cases/${caseId}/documents/${documentId}/supersede`,
      ),
    onSuccess: (result: { bounced?: boolean }) => {
      toast({
        title: "Document superseded",
        description: result?.bounced
          ? "The case no longer passes readiness and was returned to draft."
          : undefined,
      });
      refresh();
    },
    onError: (err) =>
      toast({
        title: "Could not supersede document",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  const files = data?.files ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Documents</CardTitle>
          <CardDescription>
            Documents are never deleted — outdated ones are superseded and stay on record.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {canSetType && (
            <Select value={uploadDocType} onValueChange={setUploadDocType}>
              <SelectTrigger className="w-[220px]" data-testid="select-dc-upload-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAO_DC_DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DC_DOC_TYPE_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = "";
            }}
            data-testid="input-dc-upload"
          />
          <Button
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending || data?.configured === false}
            data-testid="button-dc-upload"
          >
            <FileUp className="h-4 w-4 mr-2" /> Upload
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {data?.configured === false && (
          <p className="text-sm text-muted-foreground mb-3" data-testid="text-dc-files-unconfigured">
            {data.message ?? "File storage is not configured for Disability Credit cases yet."}
          </p>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-dc-documents-empty">
            No documents uploaded yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Uploaded by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((f) => {
                const superseded = Boolean(f.data?.supersededAt);
                return (
                  <TableRow
                    key={f.id}
                    className={superseded ? "opacity-60" : undefined}
                    data-testid={`row-dc-document-${f.id}`}
                  >
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell>
                      {canSetType && !superseded ? (
                        <Select
                          value={f.data?.docType ?? "other"}
                          onValueChange={(docType) => setType.mutate({ id: f.id, docType })}
                        >
                          <SelectTrigger className="w-[210px]" data-testid={`select-dc-doc-type-${f.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BAO_DC_DOCUMENT_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {DC_DOC_TYPE_LABELS[t] ?? t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">
                          {DC_DOC_TYPE_LABELS[f.data?.docType ?? "other"] ?? f.data?.docType}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {f.data?.uploadedByUserId ?? "—"}
                    </TableCell>
                    <TableCell>
                      {superseded ? (
                        <Badge variant="secondary" data-testid={`badge-dc-superseded-${f.id}`}>
                          <History className="h-3 w-3 mr-1" /> Superseded
                        </Badge>
                      ) : (
                        <Badge variant="outline">Current</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button asChild variant="ghost" size="sm">
                        <a
                          href={`/api/files/${f.fileId}/download`}
                          data-testid={`link-dc-download-${f.id}`}
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                      {canSupersede && !superseded && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => supersede.mutate(f.id)}
                          disabled={supersede.isPending}
                          data-testid={`button-dc-supersede-${f.id}`}
                        >
                          Supersede
                        </Button>
                      )}
                    </TableCell>
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
