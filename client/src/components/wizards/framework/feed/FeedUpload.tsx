import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileSpreadsheet, Check } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

const ALLOWED = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

/**
 * Generic escape-hatch `upload` step for feed/import wizards. Posts the
 * file through the fixed dispatcher upload route
 * (POST .../dispatch/:stepId/upload) — the server handler stores it via
 * `storage.files` + object storage, parses columns, and writes
 * `uploadedFileId` + preview into `wizard.data`. No wizard-specific route.
 */
export function FeedUpload({
  wizardId,
  step,
  data,
}: WizardStepComponentProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const currentFileName: string | undefined = data?.fileName;

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(
        `/api/wizards/${wizardId}/dispatch/${step.id}/upload`,
        { method: "POST", credentials: "include", body: formData },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to upload file");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      queryClient.invalidateQueries({
        queryKey: ["/api/wizards", wizardId, "dispatch"],
      });
      setSelected(null);
      if (inputRef.current) inputRef.current.value = "";
      toast({
        title: "File Uploaded",
        description: "Your file has been uploaded successfully.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Upload Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleUpload = () => {
    if (!selected) return;
    if (selected.type && !ALLOWED.includes(selected.type)) {
      toast({
        title: "Invalid file type",
        description: "Only CSV and XLSX files are supported.",
        variant: "destructive",
      });
      return;
    }
    uploadMutation.mutate(selected);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{step.name}</CardTitle>
        <CardDescription>
          Upload a CSV or XLSX file containing the data to be processed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-3">
          <Input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setSelected(e.target.files?.[0] ?? null)}
            disabled={uploadMutation.isPending}
            data-testid="input-file-upload"
            className="flex-1"
          />
          <Button
            type="button"
            onClick={handleUpload}
            disabled={!selected || uploadMutation.isPending}
            data-testid="button-upload-file"
          >
            {uploadMutation.isPending ? (
              "Uploading…"
            ) : (
              <>
                <Upload size={16} className="mr-2" />
                Upload
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Accepted formats: CSV, XLSX (max 50MB)
        </p>

        {currentFileName && (
          <div
            className="flex items-center gap-3 p-3 border rounded-lg bg-muted/50"
            data-testid="text-current-file"
          >
            <FileSpreadsheet size={20} className="text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentFileName}</p>
              <p className="text-xs text-muted-foreground">
                Uploaded — upload a new file to replace it.
              </p>
            </div>
            <Check size={16} className="text-green-600 dark:text-green-400" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
