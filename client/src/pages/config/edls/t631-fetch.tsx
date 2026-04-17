import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Play, Loader2, CheckCircle2, XCircle, Clock, Zap, Send, ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface RequestDiagnostics {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown[];
}

interface ResponseDiagnostics {
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

interface FetchResult {
  success: boolean;
  action: string;
  request: RequestDiagnostics;
  response?: ResponseDiagnostics;
  data?: unknown;
  rawBody?: string;
  error?: string;
  timestamp: string;
  durationMs: number;
}

const ACTIONS = [
  { value: "sirius_service_ping", label: "Ping", description: "Test connectivity to the T631 server" },
  { value: "sirius_edls_server_worker_list", label: "Worker List", description: "Fetch the list of workers from the T631 server" },
  { value: "sirius_dispatch_group_search", label: "Dispatch Group Search", description: "Search dispatch groups on the T631 server" },
  { value: "sirius_dispatch_facility_dropdown", label: "Facility Dropdown", description: "Fetch the facility dropdown list from the T631 server" },
  { value: "sirius_edls_server_tos_list", label: "TOs List", description: "Fetch the list of absences (TOs) from the T631 server" },
];

export default function T631FetchPage() {
  usePageTitle("Teamsters 631 Fetch");
  const { toast } = useToast();
  const [action, setAction] = useState("sirius_service_ping");
  const [result, setResult] = useState<FetchResult | null>(null);

  const fetchMutation = useMutation({
    mutationFn: async (selectedAction: string) => {
      const res = await fetch("/api/sitespecific/t631/client/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: selectedAction }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      return res.json() as Promise<FetchResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.success) {
        toast({ title: "Fetch complete", description: `${data.action} succeeded in ${data.durationMs}ms` });
      } else {
        toast({ title: "Fetch failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleRun = () => {
    setResult(null);
    fetchMutation.mutate(action);
  };

  const selectedAction = ACTIONS.find((a) => a.value === action);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Teamsters 631 Fetch
          </CardTitle>
          <CardDescription>
            Test connectivity and fetch data from the Teamsters 631 server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="space-y-2 flex-1 max-w-sm">
              <Label htmlFor="action-select">Action</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger id="action-select" data-testid="select-action">
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value} data-testid={`select-action-${a.value}`}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleRun}
              disabled={fetchMutation.isPending}
              data-testid="button-run-fetch"
            >
              {fetchMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Run
            </Button>
          </div>

          {selectedAction && (
            <p className="text-sm text-muted-foreground">
              {selectedAction.description}
            </p>
          )}
        </CardContent>
      </Card>

      {result && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                Result
                <Badge variant={result.success ? "default" : "destructive"} data-testid="badge-result-status">
                  {result.success ? "Success" : "Failed"}
                </Badge>
                {result.response && (
                  <Badge variant="outline" data-testid="badge-http-status">
                    HTTP {result.response.status}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {result.durationMs}ms
                </span>
                <span>{result.timestamp}</span>
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Send className="h-4 w-4" />
                Request
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">URL</Label>
                <pre className="rounded-md bg-muted p-2 text-xs overflow-auto" data-testid="text-request-url">
                  {result.request.method} {result.request.url}
                </pre>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Headers</Label>
                <pre className="rounded-md bg-muted p-2 text-xs overflow-auto" data-testid="text-request-headers">
                  {Object.entries(result.request.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}
                </pre>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Body</Label>
                <pre className="rounded-md bg-muted p-2 text-xs overflow-auto" data-testid="text-request-body">
                  {JSON.stringify(result.request.body, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <ArrowDownToLine className="h-4 w-4" />
                Response
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.error && !result.response && (
                <div className="text-sm text-red-600 dark:text-red-400" data-testid="text-error">
                  {result.error}
                </div>
              )}

              {result.response && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <pre className="rounded-md bg-muted p-2 text-xs overflow-auto" data-testid="text-response-status">
                      {result.response.status} {result.response.statusText}
                    </pre>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Headers</Label>
                    <pre className="rounded-md bg-muted p-2 text-xs overflow-auto max-h-40" data-testid="text-response-headers">
                      {Object.entries(result.response.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}
                    </pre>
                  </div>
                </>
              )}

              {result.data !== undefined && (
                <div>
                  <Label className="text-xs text-muted-foreground">Body (JSON)</Label>
                  <pre
                    className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-96"
                    data-testid="text-response-data"
                  >
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </div>
              )}

              {result.rawBody !== undefined && (
                <div>
                  <Label className="text-xs text-muted-foreground">Body (Raw — not valid JSON)</Label>
                  <pre
                    className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-96 text-red-600 dark:text-red-400"
                    data-testid="text-response-raw"
                  >
                    {result.rawBody || "(empty)"}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
