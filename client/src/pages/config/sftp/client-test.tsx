import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { SftpClientLayout, useSftpClientLayout } from "@/components/layouts/SftpClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2, Plug, FolderOpen, Upload, Download, Clock, CheckCircle, XCircle,
  FileIcon, FolderIcon, AlertTriangle, ArrowRight, Link as LinkIcon,
} from "lucide-react";
import { connectionDataSchema } from "@shared/schema/system/sftp-client-schema";

interface FileEntry {
  name: string;
  type: "file" | "directory" | "unknown";
  size: number;
  modifiedAt: string | null;
}

interface LogEntry {
  timestamp: string;
  action: string;
  success: boolean;
  duration: number;
  message: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function TestContent() {
  const { destination } = useSftpClientLayout();
  const { toast } = useToast();
  const logEndRef = useRef<HTMLDivElement>(null);

  const parsed = connectionDataSchema.safeParse(destination.data);
  const hasConnection = parsed.success;

  const [currentPath, setCurrentPath] = useState(
    hasConnection ? (parsed.data?.homeDir || "/") : "/"
  );
  const [cdInput, setCdInput] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((entry: Omit<LogEntry, "timestamp">) => {
    setLogs((prev) => [
      ...prev,
      { ...entry, timestamp: new Date().toISOString() },
    ]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const callTestApi = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    const resp = await apiRequest("POST", `/api/sftp/client-destinations/${destination.id}/test/${action}`, body);
    return resp as { success: boolean; duration: number; data?: unknown; error?: string };
  }, [destination.id]);

  const connectMutation = useMutation({
    mutationFn: () => callTestApi("connect"),
    onSuccess: (result) => {
      setIsConnected(result.success);
      addLog({
        action: "Connect",
        success: result.success,
        duration: result.duration,
        message: result.success
          ? `Connected successfully${result.data ? ` — ${(result.data as Record<string, string>).banner || ""}` : ""}`
          : `Connection failed: ${result.error}`,
      });
      if (!result.success) {
        toast({ title: "Connection failed", description: result.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      setIsConnected(false);
      addLog({ action: "Connect", success: false, duration: 0, message: error.message });
      toast({ title: "Connection error", description: error.message, variant: "destructive" });
    },
  });

  const listMutation = useMutation({
    mutationFn: (path: string) => callTestApi("list", { path }),
    onSuccess: (result) => {
      if (result.success && Array.isArray(result.data)) {
        setFiles(result.data as FileEntry[]);
        setSelectedFile(null);
      }
      addLog({
        action: "List",
        success: result.success,
        duration: result.duration,
        message: result.success
          ? `Listed ${(result.data as FileEntry[])?.length ?? 0} items in ${currentPath}`
          : `List failed: ${result.error}`,
      });
      if (!result.success) {
        toast({ title: "List failed", description: result.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      addLog({ action: "List", success: false, duration: 0, message: error.message });
    },
  });

  const cdMutation = useMutation({
    mutationFn: (path: string) => callTestApi("cd", { path }),
    onSuccess: (result, path) => {
      addLog({
        action: "Change Directory",
        success: result.success,
        duration: result.duration,
        message: result.success
          ? `Changed directory to ${(result.data as { path: string })?.path || path}`
          : `cd failed: ${result.error}`,
      });
      if (result.success) {
        const newPath = (result.data as { path: string })?.path || path;
        setCurrentPath(newPath);
        setCdInput("");
        listMutation.mutate(newPath);
      } else {
        toast({ title: "cd failed", description: result.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      addLog({ action: "Change Directory", success: false, duration: 0, message: error.message });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const input = document.createElement("input");
      input.type = "file";
      const file = await new Promise<File | null>((resolve) => {
        input.onchange = () => resolve(input.files?.[0] || null);
        input.click();
      });
      if (!file) throw new Error("No file selected");
      if (file.size > 1024 * 1024) throw new Error("File must be under 1 MB");
      const arrayBuf = await file.arrayBuffer();
      const contentBase64 = btoa(
        new Uint8Array(arrayBuf).reduce((s, b) => s + String.fromCharCode(b), "")
      );
      return callTestApi("upload", { path: currentPath, fileName: file.name, contentBase64 });
    },
    onSuccess: (result) => {
      addLog({
        action: "Upload",
        success: result.success,
        duration: result.duration,
        message: result.success
          ? `Uploaded ${(result.data as { bytesWritten: number })?.bytesWritten ?? 0} bytes`
          : `Upload failed: ${result.error}`,
      });
      if (result.success) {
        listMutation.mutate(currentPath);
      } else {
        toast({ title: "Upload failed", description: result.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      addLog({ action: "Upload", success: false, duration: 0, message: error.message });
      toast({ title: "Upload error", description: error.message, variant: "destructive" });
    },
  });

  const [isDownloading, setIsDownloading] = useState(false);

  const triggerDownload = useCallback(async (filePath: string) => {
    setIsDownloading(true);
    const start = Date.now();
    try {
      const url = `/api/sftp/client-destinations/${destination.id}/test/download?path=${encodeURIComponent(filePath)}`;
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(body.message || `Download failed (${response.status})`);
      }

      const contentDisposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
      const fileName = filenameMatch ? decodeURIComponent(filenameMatch[1]) : (selectedFile || "downloaded-file");

      const blob = await response.blob();
      const duration = Date.now() - start;

      addLog({
        action: "Download",
        success: true,
        duration,
        message: `Downloaded ${formatBytes(blob.size)}`,
      });

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (error: unknown) {
      const duration = Date.now() - start;
      const message = error instanceof Error ? error.message : "Download failed";
      addLog({ action: "Download", success: false, duration, message });
      toast({ title: "Download failed", description: message, variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  }, [destination.id, selectedFile, addLog, toast]);

  const handleCd = () => {
    const target = cdInput.trim();
    if (!target) return;
    cdMutation.mutate(target);
  };

  const handleDirectoryClick = (dirName: string) => {
    const newPath = currentPath.endsWith("/")
      ? `${currentPath}${dirName}`
      : `${currentPath}/${dirName}`;
    cdMutation.mutate(newPath);
  };

  const handleDownload = () => {
    if (!selectedFile) return;
    const filePath = currentPath.endsWith("/")
      ? `${currentPath}${selectedFile}`
      : `${currentPath}/${selectedFile}`;
    triggerDownload(filePath);
  };

  const isAnyPending =
    connectMutation.isPending || listMutation.isPending || cdMutation.isPending ||
    uploadMutation.isPending || isDownloading;

  if (!hasConnection) {
    return (
      <div className="space-y-6">
        <Alert data-testid="alert-no-connection">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center gap-2">
            No connection data configured.
            <a
              href={`/config/sftp/client/${destination.id}/connection`}
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
              data-testid="link-configure-connection"
            >
              <LinkIcon className="h-3 w-3" />
              Configure Connection
            </a>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Card data-testid="card-actions">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              Connection Test
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
                data-testid="button-connect"
              >
                {connectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4 mr-2" />
                )}
                Connect
              </Button>
              {isConnected && (
                <Badge variant="default" className="gap-1" data-testid="badge-connected">
                  <CheckCircle className="h-3 w-3" /> Connected
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-browse">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Browse Remote Files
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Current Path</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-md font-mono" data-testid="text-current-path">
                  {currentPath}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => listMutation.mutate(currentPath)}
                  disabled={listMutation.isPending}
                  data-testid="button-list"
                >
                  {listMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderOpen className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cd-input">Change Directory</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="cd-input"
                  value={cdInput}
                  onChange={(e) => setCdInput(e.target.value)}
                  placeholder="/path/to/directory"
                  onKeyDown={(e) => e.key === "Enter" && handleCd()}
                  data-testid="input-cd"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCd}
                  disabled={cdMutation.isPending || !cdInput.trim()}
                  data-testid="button-cd"
                >
                  {cdMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending}
                data-testid="button-upload"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Upload File
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownload}
                disabled={isDownloading || !selectedFile}
                data-testid="button-download"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download{selectedFile ? `: ${selectedFile}` : ""}
              </Button>
            </div>

            {files.length > 0 && (
              <div className="border rounded-md max-h-[300px] overflow-auto" data-testid="table-files">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-[80px]">Type</TableHead>
                      <TableHead className="w-[100px] text-right">Size</TableHead>
                      <TableHead className="w-[160px]">Modified</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((file) => (
                      <TableRow
                        key={file.name}
                        className={`cursor-pointer ${
                          selectedFile === file.name ? "bg-muted" : ""
                        }`}
                        onClick={() => {
                          if (file.type === "directory") {
                            handleDirectoryClick(file.name);
                          } else {
                            setSelectedFile(file.name === selectedFile ? null : file.name);
                          }
                        }}
                        data-testid={`row-file-${file.name}`}
                      >
                        <TableCell className="font-mono text-sm flex items-center gap-2">
                          {file.type === "directory" ? (
                            <FolderIcon className="h-4 w-4 text-blue-500 shrink-0" />
                          ) : (
                            <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          {file.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {file.type === "directory" ? "dir" : file.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {file.type === "file" ? formatBytes(file.size) : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {file.modifiedAt
                            ? new Date(file.modifiedAt).toLocaleString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {files.length === 0 && !listMutation.isPending && (
              <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-files">
                Click the folder icon to list files in the current path.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-diagnostics" className="h-full flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Diagnostic Log
              </span>
              {isAnyPending && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-log-placeholder">
                Run test operations to see diagnostic results here.
              </p>
            ) : (
              <div
                className="space-y-2 max-h-[500px] overflow-auto pr-2"
                data-testid="log-entries"
              >
                {logs.map((entry, i) => (
                  <div
                    key={i}
                    className="border rounded-md p-3 text-sm space-y-1"
                    data-testid={`log-entry-${i}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {entry.success ? (
                          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <span className="font-medium">{entry.action}</span>
                      </div>
                      {entry.duration > 0 && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Clock className="h-3 w-3" />
                          {entry.duration}ms
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs break-all">
                      {entry.message}
                    </p>
                    <p className="text-muted-foreground text-[10px]">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SftpClientTestPage() {
  return (
    <SftpClientLayout activeTab="test">
      <TestContent />
    </SftpClientLayout>
  );
}
