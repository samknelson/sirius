import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Send,
  Server,
  XCircle,
} from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { getApiErrorMessage } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import EdlsMigrateSweep from "@/components/sitespecific/freeman/EdlsMigrateSweep";

interface SettingsStatus {
  configured: boolean;
  missingSettings: string[];
  url: string | null;
  user: string | null;
}

interface RequestDiagnostics {
  url: string;
  method: string;
  headers: Record<string, string>;
  authUser: string;
  body: unknown[];
}

interface ResponseDiagnostics {
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

type Outcome =
  | "success"
  | "not_configured"
  | "network_error"
  | "http_error"
  | "remote_failure"
  | "unrecognized_response";

interface PingResult {
  success: boolean;
  outcome: Outcome;
  action: string;
  missingSettings?: string[];
  request?: RequestDiagnostics;
  response?: ResponseDiagnostics;
  data?: unknown;
  rawBody?: string;
  remoteMessages?: string[];
  echo?: { sent: string; returned: boolean };
  error?: string;
  timestamp: string;
  durationMs: number;
}

const OUTCOME_LABELS: Record<Outcome, string> = {
  success: "Connected",
  not_configured: "Not configured",
  network_error: "Could not reach the legacy system",
  http_error: "The legacy system refused the request",
  remote_failure: "The legacy system reported a failure",
  unrecognized_response: "Unrecognized answer",
};

export default function FreemanEdlsMigratePage() {
  usePageTitle("Freeman EDLS Migration");
  const { toast } = useToast();
  const [result, setResult] = useState<PingResult | null>(null);

  const settingsQuery = useQuery<SettingsStatus>({
    queryKey: ["/api/sitespecific/freeman/edls-migrate/settings"],
  });

  const pingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sitespecific/freeman/edls-migrate/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      return (await res.json()) as PingResult;
    },
    onSuccess: (data) => {
      setResult(data);
      settingsQuery.refetch();
      if (data.success) {
        toast({
          title: "Connected",
          description: `The legacy system answered in ${data.durationMs}ms.`,
        });
      } else {
        toast({
          title: OUTCOME_LABELS[data.outcome],
          description: data.error || "The ping did not succeed.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "The ping could not be run."),
        variant: "destructive",
      });
    },
  });

  const settings = settingsQuery.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Freeman EDLS Migration
          </CardTitle>
          <CardDescription>
            Connection to Freeman's legacy EDLS system. Nothing has been imported yet:
            this page tests the connection and copies legacy sheets into a staging table
            for inspection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Settings</Label>
            {settingsQuery.isLoading && (
              <p className="text-sm text-muted-foreground" data-testid="text-settings-loading">
                Checking settings…
              </p>
            )}
            {settingsQuery.isError && (
              <Alert variant="destructive" data-testid="alert-settings-error">
                <AlertDescription>
                  {getApiErrorMessage(settingsQuery.error, "Could not read the settings.")}
                </AlertDescription>
              </Alert>
            )}
            {settings && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={settings.configured ? "default" : "destructive"}
                    data-testid="badge-settings-status"
                  >
                    {settings.configured ? "Configured" : "Incomplete"}
                  </Badge>
                  <Badge variant="outline" data-testid="badge-setting-url">
                    Address {settings.url ? "set" : "missing"}
                  </Badge>
                  <Badge variant="outline" data-testid="badge-setting-user">
                    User {settings.user ? "set" : "missing"}
                  </Badge>
                  <Badge variant="outline" data-testid="badge-setting-pass">
                    Password{" "}
                    {settings.missingSettings.some((n) => n.endsWith("_PASS"))
                      ? "missing"
                      : "set"}
                  </Badge>
                </div>
                {settings.url && (
                  <pre
                    className="rounded-md bg-muted p-2 text-xs overflow-auto"
                    data-testid="text-settings-endpoint"
                  >
                    {settings.url}
                    {settings.user ? `\nas ${settings.user}` : ""}
                  </pre>
                )}
                {!settings.configured && (
                  <Alert data-testid="alert-settings-missing">
                    <AlertDescription>
                      Set{" "}
                      <span className="font-mono text-xs">
                        {settings.missingSettings.join(", ")}
                      </span>{" "}
                      on the Environment Variables page before running the ping. The
                      password is stored as a secret and is never shown here.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          <Button
            onClick={() => {
              setResult(null);
              pingMutation.mutate();
            }}
            disabled={pingMutation.isPending}
            data-testid="button-run-ping"
          >
            {pingMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run ping
          </Button>
        </CardContent>
      </Card>

      <EdlsMigrateSweep configured={settings?.configured ?? false} />

      {result && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                Result
                <Badge
                  variant={result.success ? "default" : "destructive"}
                  data-testid="badge-result-status"
                >
                  {OUTCOME_LABELS[result.outcome]}
                </Badge>
                {result.response && (
                  <Badge variant="outline" data-testid="badge-http-status">
                    HTTP {result.response.status}
                  </Badge>
                )}
                {result.echo && (
                  <Badge variant="outline" data-testid="badge-echo">
                    {result.echo.returned ? "Payload echoed back" : "Payload not echoed"}
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
            <CardContent className="space-y-3">
              {result.error && (
                <div className="text-sm text-red-600 dark:text-red-400" data-testid="text-error">
                  {result.error}
                </div>
              )}
              {result.missingSettings && result.missingSettings.length > 0 && (
                <div className="text-sm" data-testid="text-missing-settings">
                  Missing:{" "}
                  <span className="font-mono text-xs">
                    {result.missingSettings.join(", ")}
                  </span>
                </div>
              )}
              {result.remoteMessages && result.remoteMessages.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    What the legacy system said
                  </Label>
                  <pre
                    className="rounded-md bg-muted p-2 text-xs overflow-auto"
                    data-testid="text-remote-messages"
                  >
                    {result.remoteMessages.join("\n")}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {result.request && (
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
                  <pre
                    className="rounded-md bg-muted p-2 text-xs overflow-auto"
                    data-testid="text-request-url"
                  >
                    {result.request.method} {result.request.url}
                  </pre>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Headers (authenticated as {result.request.authUser})
                  </Label>
                  <pre
                    className="rounded-md bg-muted p-2 text-xs overflow-auto"
                    data-testid="text-request-headers"
                  >
                    {Object.entries(result.request.headers)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("\n")}
                  </pre>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Body</Label>
                  <pre
                    className="rounded-md bg-muted p-2 text-xs overflow-auto"
                    data-testid="text-request-body"
                  >
                    {JSON.stringify(result.request.body, null, 2)}
                  </pre>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <ArrowDownToLine className="h-4 w-4" />
                Response
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!result.response && (
                <p className="text-sm text-muted-foreground" data-testid="text-no-response">
                  No response was received.
                </p>
              )}

              {result.response && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <pre
                      className="rounded-md bg-muted p-2 text-xs overflow-auto"
                      data-testid="text-response-status"
                    >
                      {result.response.status} {result.response.statusText}
                    </pre>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Headers</Label>
                    <pre
                      className="rounded-md bg-muted p-2 text-xs overflow-auto max-h-40"
                      data-testid="text-response-headers"
                    >
                      {Object.entries(result.response.headers)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join("\n")}
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
                  <Label className="text-xs text-muted-foreground">
                    Body (raw — not valid JSON)
                  </Label>
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
