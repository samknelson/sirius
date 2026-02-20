import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UploadStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

export function UploadStep({ wizardId, wizardType, data, onDataChange }: UploadStepProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('wizardId', wizardId);

      const res = await fetch('/api/btu-building-rep-import/upload-preview', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Upload failed' }));
        throw new Error(err.message || 'Upload failed');
      }

      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "CSV Uploaded",
        description: `Found ${result.totalRows} rows. ${result.matchedCount} matched, ${result.unmatchedCount} unmatched.`,
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

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const hasPreviewData = !!data?.previewData;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Building Rep CSV
          </CardTitle>
          <CardDescription>
            Upload a CSV file with columns: Name, ID/Badge #, Phone, Email
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasPreviewData && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>File Already Uploaded</AlertTitle>
              <AlertDescription>
                File "{data.csvFileName}" has been uploaded with {data.previewData.totalRows} rows.
                You can upload a new file to replace it.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-md space-y-4">
            <FileText className="h-12 w-12 text-muted-foreground" />
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Select a CSV file with building representative data
              </p>
              <p className="text-xs text-muted-foreground">
                Expected format: Name, ID/Badge #, Phone, Email
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              data-testid="input-file-csv"
            />

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                data-testid="button-select-file"
              >
                <FileText className="h-4 w-4 mr-2" />
                Select File
              </Button>

              {selectedFile && (
                <Button
                  onClick={handleUpload}
                  disabled={uploadMutation.isPending}
                  data-testid="button-upload-csv"
                >
                  {uploadMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload & Preview
                    </>
                  )}
                </Button>
              )}
            </div>

            {selectedFile && (
              <p className="text-sm text-muted-foreground">
                Selected: {selectedFile.name}
              </p>
            )}
          </div>

          {uploadMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Upload Error</AlertTitle>
              <AlertDescription>{uploadMutation.error.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
