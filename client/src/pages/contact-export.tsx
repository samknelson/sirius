import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExportResult {
  matched: number;
  unmatched: number;
  unmatchedIds: string[];
  downloaded: boolean;
}

export default function ContactExportPage() {
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: idTypes = [], isLoading: typesLoading } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/options/worker-id-type"],
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setResult(null);
  };

  const handleExport = async () => {
    if (!selectedFile || !selectedTypeId) return;

    setIsExporting(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("typeId", selectedTypeId);

      const response = await fetch("/api/workers/contact-export", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.message || `Export failed with status ${response.status}`);
      }

      const data = await response.json();

      if (data.matched === 0) {
        setResult({
          matched: 0,
          unmatched: data.unmatched,
          unmatchedIds: data.unmatchedIds || [],
          downloaded: false,
        });
        toast({
          title: "No matches found",
          description: "None of the uploaded IDs matched any workers.",
          variant: "destructive",
        });
      } else {
        const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `contact_export_${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setResult({
          matched: data.matched,
          unmatched: data.unmatched,
          unmatchedIds: data.unmatchedIds || [],
          downloaded: true,
        });

        toast({
          title: "Export complete",
          description: `${data.matched} worker(s) exported successfully.`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Export failed",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold" data-testid="text-page-title">Contact Export</h1>
        <p className="text-muted-foreground mt-1" data-testid="text-page-description">
          Upload a list of worker IDs to export their contact, employment, and membership data as a spreadsheet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Export Settings
          </CardTitle>
          <CardDescription>
            Select the ID type and upload a file containing one ID per line.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="id-type" data-testid="label-id-type">Worker ID Type</Label>
            <Select
              value={selectedTypeId}
              onValueChange={(value) => {
                setSelectedTypeId(value);
                setResult(null);
              }}
              disabled={typesLoading || isExporting}
            >
              <SelectTrigger id="id-type" data-testid="select-id-type">
                <SelectValue placeholder={typesLoading ? "Loading..." : "Select an ID type"} />
              </SelectTrigger>
              <SelectContent>
                {idTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id} data-testid={`select-item-id-type-${type.id}`}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose which type of ID is in your uploaded file.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file-upload" data-testid="label-file-upload">ID File</Label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExporting}
                data-testid="button-choose-file"
              >
                <Upload className="h-4 w-4 mr-2" />
                Choose File
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-file-name">
                {selectedFile ? selectedFile.name : "No file selected"}
              </span>
            </div>
            <input
              ref={fileInputRef}
              id="file-upload"
              type="file"
              accept=".csv,.txt,.text"
              onChange={handleFileChange}
              className="hidden"
              data-testid="input-file-upload"
            />
            <p className="text-xs text-muted-foreground">
              Upload a .csv or .txt file with one worker ID per line.
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={handleExport}
              disabled={!selectedFile || !selectedTypeId || isExporting}
              data-testid="button-export"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {isExporting ? "Exporting..." : "Export Contacts"}
            </Button>
            {(selectedFile || result) && (
              <Button variant="outline" onClick={handleReset} disabled={isExporting} data-testid="button-reset">
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Export Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              {result.matched > 0 && (
                <Alert className="flex-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle data-testid="text-matched-count">Matched: {result.matched}</AlertTitle>
                  <AlertDescription>
                    {result.downloaded
                      ? "Contact data downloaded as CSV."
                      : "Workers found but no CSV generated."}
                  </AlertDescription>
                </Alert>
              )}
              {result.unmatched > 0 && (
                <Alert variant="destructive" className="flex-1">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle data-testid="text-unmatched-count">Unmatched: {result.unmatched}</AlertTitle>
                  <AlertDescription>
                    IDs not found in the system.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {result.unmatchedIds.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium" data-testid="text-unmatched-label">Unmatched IDs</span>
                </div>
                <div
                  className="bg-muted rounded-md p-3 max-h-48 overflow-y-auto text-sm font-mono"
                  data-testid="text-unmatched-ids"
                >
                  {result.unmatchedIds.map((id, i) => (
                    <div key={i}>{id}</div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
