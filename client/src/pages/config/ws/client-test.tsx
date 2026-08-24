import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Loader2, Play, CheckCircle, XCircle, Clock, FlaskConical, Copy, Check, Terminal } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { WsClientLayout, useWsClientLayout } from "@/components/layouts/WsClientLayout";
import {
  useWsServiceConfigs,
  useWsServicePlugins,
  useWsClientGrants,
  wsServiceLabel,
  wsServiceAddress,
} from "./use-ws-services";

function generateCurlCommand(options: {
  baseUrl: string;
  method: string;
  path: string;
  queryParams: string;
  requestBody: string;
  clientKey: string;
  clientSecret: string;
}): string {
  const { baseUrl, method, path, queryParams, requestBody, clientKey, clientSecret } = options;
  
  let fullUrl = `${baseUrl}${path}`;
  
  if (queryParams.trim()) {
    try {
      const params = JSON.parse(queryParams);
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        searchParams.append(key, String(value));
      }
      const qs = searchParams.toString();
      if (qs) {
        fullUrl += `?${qs}`;
      }
    } catch {
    }
  }
  
  const parts: string[] = ["curl"];
  
  if (method !== "GET") {
    parts.push(`-X ${method}`);
  }
  
  parts.push(`-H "X-WS-Client-Key: ${clientKey || '<YOUR_CLIENT_KEY>'}"`);
  parts.push(`-H "X-WS-Client-Secret: ${clientSecret || '<YOUR_CLIENT_SECRET>'}"`);
  
  if (["POST", "PUT", "PATCH"].includes(method)) {
    parts.push('-H "Content-Type: application/json"');
    
    if (requestBody.trim()) {
      const escapedBody = requestBody.replace(/'/g, "'\\''");
      parts.push(`-d '${escapedBody}'`);
    }
  }
  
  parts.push(`"${fullUrl}"`);
  
  return parts.join(" \\\n  ");
}

interface TestResponse {
  success: boolean;
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  data?: unknown;
  error?: string;
  message?: string;
  duration: number;
  requestInfo?: {
    method: string;
    url: string;
  };
}

function TestContent() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();

  const [clientKey, setClientKey] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">("POST");
  const [configId, setConfigId] = useState("");
  const [operation, setOperation] = useState("");
  const [queryParams, setQueryParams] = useState("");
  const [requestBody, setRequestBody] = useState("");
  const [testResult, setTestResult] = useState<TestResponse | null>(null);

  // The operation list is driven by what this client is ACTUALLY granted, not
  // by everything that exists: an operation the test screen offers but the
  // dispatcher refuses would be indistinguishable from a broken service.
  const { data: allConfigs = [] } = useWsServiceConfigs();
  const { data: plugins = [] } = useWsServicePlugins();
  const { data: grants = [] } = useWsClientGrants(params.id);

  const grantedConfigs = useMemo(() => {
    const grantedIds = new Set(grants.map((g) => g.configId));
    return allConfigs.filter((c) => grantedIds.has(c.id));
  }, [allConfigs, grants]);

  const selectedConfig = grantedConfigs.find((c) => c.id === configId);
  const selectedPlugin = selectedConfig
    ? plugins.find((p) => p.id === selectedConfig.pluginId)
    : undefined;
  const operations = selectedPlugin?.operations ?? [];
  const selectedOperation = operations.find((op) => op.name === operation);

  const testMutation = useMutation({
    mutationFn: async () => {
      let parsedQueryParams: Record<string, string> | undefined;
      if (queryParams.trim()) {
        try {
          parsedQueryParams = JSON.parse(queryParams);
        } catch {
          throw new Error("Invalid query parameters JSON");
        }
      }

      let parsedBody: unknown | undefined;
      if (requestBody.trim() && ["POST", "PUT", "PATCH"].includes(method)) {
        try {
          parsedBody = JSON.parse(requestBody);
        } catch {
          throw new Error("Invalid request body JSON");
        }
      }

      return apiRequest("POST", `/api/admin/ws-clients/${params.id}/test`, {
        clientKey,
        clientSecret,
        method,
        configRef: configId,
        operation,
        queryParams: parsedQueryParams,
        body: parsedBody,
      });
    },
    onSuccess: (data: TestResponse) => {
      setTestResult(data);
    },
    onError: (error: any) => {
      toast({
        title: "Test failed",
        description: getApiErrorMessage(error, "An error occurred"),
        variant: "destructive",
      });
    },
  });

  const handleServiceSelect = (value: string) => {
    setConfigId(value);
    setOperation("");
  };

  const handleOperationSelect = (value: string) => {
    setOperation(value);
    const op = operations.find((o) => o.name === value);
    // Default to the operation's first declared verb; anything else is
    // refused by the dispatcher with a 405.
    if (op?.methods.length) {
      setMethod(op.methods[0] as typeof method);
    }
  };

  const canExecute = clientKey.trim() && clientSecret.trim() && configId && operation;
  const [copied, setCopied] = useState(false);

  // The public address. Prefer the alias: configuration ids are minted per
  // database, so a copied cURL built on an id only works here.
  const address = selectedConfig ? wsServiceAddress(selectedConfig) : "<service>";
  const origin = typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.host}`
    : "";
  const baseUrl = `${origin}/api/ws/${address}`;
  const path = `/${operation || "<operation>"}`;

  const curlCommand = useMemo(() => {
    return generateCurlCommand({
      baseUrl,
      method,
      path,
      queryParams,
      requestBody,
      clientKey,
      clientSecret,
    });
  }, [baseUrl, method, path, queryParams, requestBody, clientKey, clientSecret]);

  const handleCopyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Unable to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Card data-testid="card-credentials">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Credentials
            </CardTitle>
            <CardDescription>
              Enter your client credentials. The secret is only shown once when created.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="client-key">Client Key</Label>
              <Input
                id="client-key"
                value={clientKey}
                onChange={(e) => setClientKey(e.target.value)}
                placeholder="Enter client key"
                data-testid="input-client-key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-secret">Client Secret</Label>
              <Input
                id="client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Enter client secret"
                data-testid="input-client-secret"
              />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-request">
          <CardHeader>
            <CardTitle>Request</CardTitle>
            <CardDescription>
              {selectedConfig
                ? `${baseUrl}${path}`
                : "Choose one of the web services this client has been granted"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {grantedConfigs.length === 0 ? (
              <Alert data-testid="alert-no-grants">
                <AlertDescription>
                  This client has not been granted access to any web service. Grant one from
                  the Settings tab first.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2">
                <Label>Service</Label>
                <Select value={configId} onValueChange={handleServiceSelect}>
                  <SelectTrigger data-testid="select-service">
                    <SelectValue placeholder="Choose a service..." />
                  </SelectTrigger>
                  <SelectContent>
                    {grantedConfigs.map((config) => (
                      <SelectItem
                        key={config.id}
                        value={config.id}
                        data-testid={`option-service-${config.id}`}
                      >
                        {wsServiceLabel(config)}
                        {!config.enabled ? " (disabled)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedConfig && (
              <div className="space-y-2">
                <Label>Operation</Label>
                <Select value={operation} onValueChange={handleOperationSelect}>
                  <SelectTrigger data-testid="select-operation">
                    <SelectValue placeholder="Choose an operation..." />
                  </SelectTrigger>
                  <SelectContent>
                    {operations.map((op) => (
                      <SelectItem
                        key={op.name}
                        value={op.name}
                        data-testid={`option-operation-${op.name}`}
                      >
                        <span className="font-mono text-xs">{op.methods.join("/")}</span>{" "}
                        <span>{op.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedOperation && (
                  <p className="text-sm text-muted-foreground" data-testid="text-operation-description">
                    {selectedOperation.description}
                  </p>
                )}
              </div>
            )}

            {selectedOperation && selectedOperation.methods.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="method">Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                  <SelectTrigger id="method" data-testid="select-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedOperation.methods.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="query-params">Query Parameters (JSON)</Label>
              <Textarea
                id="query-params"
                value={queryParams}
                onChange={(e) => setQueryParams(e.target.value)}
                placeholder='{"page": "1", "limit": "10"}'
                className="font-mono text-sm"
                rows={2}
                data-testid="input-query-params"
              />
            </div>

            {["POST", "PUT", "PATCH"].includes(method) && (
              <div className="space-y-2">
                <Label htmlFor="request-body">Request Body (JSON)</Label>
                <Textarea
                  id="request-body"
                  value={requestBody}
                  onChange={(e) => setRequestBody(e.target.value)}
                  placeholder="{}"
                  className="font-mono text-sm"
                  rows={4}
                  data-testid="input-request-body"
                />
              </div>
            )}

            <Button
              onClick={() => testMutation.mutate()}
              disabled={!canExecute || testMutation.isPending}
              className="w-full"
              data-testid="button-execute"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Execute Request
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-curl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                cURL Command
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyCurl}
                data-testid="button-copy-curl"
              >
                {copied ? (
                  <Check className="h-4 w-4 mr-1" />
                ) : (
                  <Copy className="h-4 w-4 mr-1" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </CardTitle>
            <CardDescription>
              Use this command to make the same request from your terminal
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre
              className="bg-muted p-4 rounded-md overflow-auto text-sm font-mono whitespace-pre-wrap break-all"
              data-testid="text-curl-command"
            >
              {curlCommand}
            </pre>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-response" className="h-full">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2">
                {testResult ? (
                  testResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )
                ) : null}
                Response
              </span>
              {testResult && (
                <div className="flex items-center gap-2">
                  <Badge variant={testResult.success ? "default" : "destructive"} data-testid="badge-status">
                    {testResult.status} {testResult.statusText}
                  </Badge>
                  <Badge variant="outline" className="gap-1" data-testid="badge-duration">
                    <Clock className="h-3 w-3" />
                    {testResult.duration}ms
                  </Badge>
                </div>
              )}
            </CardTitle>
            {testResult?.requestInfo && (
              <CardDescription>
                {testResult.requestInfo.method} {testResult.requestInfo.url}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!testResult && (
              <div className="text-muted-foreground text-sm py-8 text-center" data-testid="text-response-placeholder">
                Execute a request to see the response here.
              </div>
            )}

            {testResult?.error && (
              <Alert variant="destructive" data-testid="alert-error">
                <AlertDescription>
                  <strong>{testResult.error}:</strong> {testResult.message}
                </AlertDescription>
              </Alert>
            )}

            {testResult && (
              <>
                <div className="space-y-2">
                  <Label>Response Data</Label>
                  <pre
                    className="bg-muted p-4 rounded-md overflow-auto max-h-[500px] text-sm font-mono whitespace-pre-wrap"
                    data-testid="text-response-data"
                  >
                    {JSON.stringify(testResult.data, null, 2)}
                  </pre>
                </div>

                {testResult.headers && Object.keys(testResult.headers).length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Response Headers
                    </summary>
                    <pre className="bg-muted p-2 rounded-md mt-2 overflow-auto text-xs font-mono">
                      {JSON.stringify(testResult.headers, null, 2)}
                    </pre>
                  </details>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function WsClientTestPage() {
  return (
    <WsClientLayout activeTab="test">
      <TestContent />
    </WsClientLayout>
  );
}
