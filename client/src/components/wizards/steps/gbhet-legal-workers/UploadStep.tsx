import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Upload, FileSpreadsheet, Trash2, Check } from "lucide-react";
import { format } from "date-fns";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const uploadFormSchema = z.object({
  file: z
    .instanceof(FileList)
    .refine((files) => files.length > 0, "Please select a file to upload")
    .refine(
      (files) => {
        const file = files[0];
        const allowedTypes = [
          "text/csv",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ];
        return file && allowedTypes.includes(file.type);
      },
      "Only CSV and XLSX files are supported"
    )
    .refine(
      (files) => files[0]?.size <= MAX_FILE_SIZE,
      "File size must be less than 50MB"
    ),
});

interface UploadStepProps {
  wizardId: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface FileRecord {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
}

export function UploadStep({ wizardId, data, onDataChange }: UploadStepProps) {
  const { toast } = useToast();

  const form = useForm<z.infer<typeof uploadFormSchema>>({
    resolver: zodResolver(uploadFormSchema),
    defaultValues: {
      file: undefined as any,
    },
  });

  const { data: files = [], isLoading: filesLoading } = useQuery<FileRecord[]>({
    queryKey: ["/api/wizards", wizardId, "files"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/wizards/${wizardId}/files`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to upload file");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards", wizardId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wizards", wizardId] });
      form.reset();
      toast({
        title: "File Uploaded",
        description: "Your file has been uploaded successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      return apiRequest("DELETE", `/api/wizards/${wizardId}/files/${fileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards", wizardId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wizards", wizardId] });
      toast({
        title: "File Deleted",
        description: "The file has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (values: z.infer<typeof uploadFormSchema>) => {
    const file = values.file[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Data File</CardTitle>
        <CardDescription>
          Upload a CSV or XLSX file containing the data to be processed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload Form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="file"
              render={({ field: { onChange, value, ...field } }) => (
                <FormItem>
                  <FormLabel>Select File</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-3">
                      <Input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={(e) => onChange(e.target.files)}
                        disabled={uploadMutation.isPending}
                        data-testid="input-file-upload"
                        className="flex-1"
                        {...field}
                      />
                      <Button
                        type="submit"
                        disabled={uploadMutation.isPending}
                        data-testid="button-upload-file"
                      >
                        {uploadMutation.isPending ? (
                          "Uploading..."
                        ) : (
                          <>
                            <Upload size={16} className="mr-2" />
                            Upload
                          </>
                        )}
                      </Button>
                    </div>
                  </FormControl>
                  <FormDescription>
                    Accepted formats: CSV, XLSX (max 50MB)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {/* Uploaded Files List */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Uploaded Files</h3>
          {filesLoading ? (
            <div className="text-sm text-muted-foreground">Loading files...</div>
          ) : files.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-lg text-center">
              No files uploaded yet
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                  data-testid={`file-item-${file.id}`}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <FileSpreadsheet size={20} className="text-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate" data-testid={`text-filename-${file.id}`}>
                          {file.fileName}
                        </p>
                        <Badge variant="secondary" className="text-xs">
                          {file.mimeType.includes("csv") ? "CSV" : "XLSX"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)} • Uploaded {format(new Date(file.uploadedAt), "PPp")}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(file.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-file-${file.id}`}
                  >
                    <Trash2 size={16} className="text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Success Message */}
        {uploadMutation.isSuccess && (
          <div 
            className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 p-3 rounded-lg"
            data-testid="text-upload-success"
          >
            <Check size={16} />
            <span>File uploaded successfully. You can proceed to the next step.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
