import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, FileArchive, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
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

      const res = await fetch('/api/btu-sig-import/upload-zip', {
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
        title: "ZIP Uploaded",
        description: `Found ${result.totalFiles} PDF files (${result.filesWithBpsId} with BPS ID).`,
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.zip')) {
        toast({
          title: "Invalid File",
          description: "Please select a ZIP file.",
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

  const isUploaded = !!data?.uploadedFileId;
  const pdfFiles = data?.pdfFiles || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Upload Signature ZIP
          </CardTitle>
          <CardDescription>
            Upload a ZIP file containing PDF signature images. Files should be named:
            LASTNAME_FIRSTNAME_BPSID_SchoolName_Number.pdf
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isUploaded && (
            <>
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                data-testid="drop-zone-zip"
              >
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-1">
                  Click to select a ZIP file
                </p>
                <p className="text-xs text-muted-foreground">
                  Maximum file size: 100MB
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="input-file-zip"
                />
              </div>

              {selectedFile && (
                <div className="flex items-center justify-between gap-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileArchive className="h-4 w-4" />
                    <span className="text-sm font-medium">{selectedFile.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </div>
                  <Button
                    onClick={handleUpload}
                    disabled={uploadMutation.isPending}
                    data-testid="button-upload-zip"
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}

          {isUploaded && (
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>Upload Complete</AlertTitle>
                <AlertDescription>
                  Found {data.totalFiles} PDF files in the ZIP ({data.filesWithBpsId} with valid BPS ID).
                </AlertDescription>
              </Alert>

              {pdfFiles.length > 0 && (
                <div className="text-sm">
                  <p className="font-medium mb-2">Sample files:</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {pdfFiles.slice(0, 10).map((f: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-muted-foreground">
                        <span className="font-mono text-xs">{f.bpsId || '???'}</span>
                        <span className="text-xs truncate">{f.filename}</span>
                      </div>
                    ))}
                    {pdfFiles.length > 10 && (
                      <p className="text-xs text-muted-foreground">...and {pdfFiles.length - 10} more</p>
                    )}
                  </div>
                </div>
              )}

              {data.totalFiles > 0 && data.filesWithBpsId < data.totalFiles && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Some files have no BPS ID</AlertTitle>
                  <AlertDescription>
                    {data.totalFiles - data.filesWithBpsId} files could not have a BPS ID extracted from their filename.
                    These files will be skipped during processing.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
