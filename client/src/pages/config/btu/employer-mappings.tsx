import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, Download, Trash2, FileText, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface FileInfo {
  id: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  mimeType: string;
}

interface FileResponse {
  file: FileInfo | null;
}

interface PreviewResponse {
  preview: string;
  totalLines: number;
}

interface DownloadResponse {
  url: string;
  fileName: string;
}

export default function BtuEmployerMappingsPage() {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: fileData, isLoading: fileLoading } = useQuery<FileResponse>({
    queryKey: ["/api/btu/employer-mappings"],
  });

  const { data: previewData, isLoading: previewLoading } = useQuery<PreviewResponse>({
    queryKey: ["/api/btu/employer-mappings/preview"],
    enabled: !!fileData?.file,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/btu/employer-mappings", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/btu/employer-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/btu/employer-mappings/preview"] });
      setSelectedFile(null);
      toast({
        title: "File uploaded",
        description: "The employer mappings file has been uploaded successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/btu/employer-mappings", {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete file");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/btu/employer-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/btu/employer-mappings/preview"] });
      toast({
        title: "File deleted",
        description: "The employer mappings file has been deleted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDownload = async () => {
    try {
      const response = await fetch("/api/btu/employer-mappings/download", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to get download URL");
      }

      const data: DownloadResponse = await response.json();
      
      const link = document.createElement("a");
      link.href = data.url;
      link.download = data.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Failed to download the file.",
        variant: "destructive",
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".csv")) {
        toast({
          title: "Invalid file type",
          description: "Please select a CSV file.",
          variant: "destructive",
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (fileLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
          BTU Employer Mappings
        </h1>
        <p className="text-muted-foreground">
          Upload and manage the employer mappings CSV file for BTU integrations.
        </p>
      </div>

      {fileData?.file ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Current File
            </CardTitle>
            <CardDescription>
              A mapping file is currently uploaded. You can preview, download, or replace it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div className="space-y-1">
                <p className="font-medium" data-testid="text-file-name">
                  {fileData.file.fileName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatFileSize(fileData.file.size)} - Uploaded {formatDate(fileData.file.uploadedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  data-testid="button-download"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      data-testid="button-delete"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete employer mappings file?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the employer mappings file. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {previewLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : previewData ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Preview (first 10 rows of {previewData.totalLines} total)</Label>
                </div>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-xs font-mono max-h-64 overflow-y-auto" data-testid="text-preview">
                  {previewData.preview}
                </pre>
              </div>
            ) : null}

            <div className="border-t pt-4">
              <Label className="text-base font-medium">Replace File</Label>
              <p className="text-sm text-muted-foreground mb-3">
                Upload a new CSV file to replace the current mapping.
              </p>
              <div className="flex items-center gap-4">
                <Input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="max-w-sm"
                  data-testid="input-file"
                />
                <Button
                  onClick={handleUpload}
                  disabled={!selectedFile || uploadMutation.isPending}
                  data-testid="button-upload"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {uploadMutation.isPending ? "Uploading..." : "Upload"}
                </Button>
              </div>
              {selectedFile && (
                <p className="text-sm text-muted-foreground mt-2">
                  Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Employer Mappings
            </CardTitle>
            <CardDescription>
              Upload a CSV file containing employer mappings for BTU integrations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
              <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No file uploaded</p>
                <p>
                  Upload a CSV file to configure employer mappings. The file will be stored
                  and can be downloaded or replaced later.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="file-upload">Select CSV File</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="file-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="max-w-sm"
                  data-testid="input-file"
                />
                <Button
                  onClick={handleUpload}
                  disabled={!selectedFile || uploadMutation.isPending}
                  data-testid="button-upload"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {uploadMutation.isPending ? "Uploading..." : "Upload"}
                </Button>
              </div>
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
