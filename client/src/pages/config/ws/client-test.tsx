import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Play, CheckCircle, XCircle, Clock, FlaskConical } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { WsClientLayout, useWsClientLayout } from "@/components/layouts/WsClientLayout";

interface BundleEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  sampleParams?: Record<string, string>;
  sampleBody?: Record<string, unknown>;
}

interface BundleEndpointsResponse {
  bundleCode: string;
  basePath: string;
  endpoints: BundleEndpoint[];
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
  const { client, bundle } = useWsClientLayout();

  const [clientKey, setClientKey] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">("GET");
  const [path, setPath] = useState("/sheets");
  const [queryParams, setQueryParams] = useState("");
  const [requestBody, setRequestBody] = useState("");
  const [testResult, setTestResult] = useState<TestResponse | null>(null);

  const { data: endpointsData } = useQuery<BundleEndpointsResponse>({
    queryKey: ["/api/admin/ws-bundles", client.bundleId, "endpoints"],
    enabled: !!client.bundleId,
  });

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
        path,
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
        description: error?.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const handleEndpointSelect = (value: string) => {
    const endpoint = endpointsData?.endpoints.find((e) => `${e.method}:${e.path}` === value);
    if (endpoint) {
      setMethod(endpoint.method);
      setPath(endpoint.path);
      if (endpoint.sampleParams) {
        setQueryParams(JSON.stringify(endpoint.sampleParams, null, 2));
      } else {
        setQueryParams("");
      }
      if (endpoint.sampleBody) {
        setRequestBody(JSON.stringify(endpoint.sampleBody, null, 2));
      } else {
        setRequestBody("");
      }
    }
  };

  const canExecute = clientKey.trim() && clientSecret.trim() && path.trim();

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
              Base path: {endpointsData?.basePath || `/api/ws/${bundle?.code || "..."}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {endpointsData && endpointsData.endpoints.length > 0 && (
              <div className="space-y-2">
                <Label>Quick Select Endpoint</Label>
                <Select onValueChange={handleEndpointSelect}>
                  <SelectTrigger data-testid="select-endpoint">
                    <SelectValue placeholder="Choose an endpoint..." />
                  </SelectTrigger>
                  <SelectContent>
                    {endpointsData.endpoints.map((ep) => (
                      <SelectItem
                        key={`${ep.method}:${ep.path}`}
                        value={`${ep.method}:${ep.path}`}
                        data-testid={`option-endpoint-${ep.method}-${ep.path.replace(/[/:]/g, "-")}`}
                      >
                        <span className="font-mono text-xs">{ep.method}</span>{" "}
                        <span>{ep.path}</span> - {ep.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-[100px_1fr] gap-4">
              <div className="space-y-2">
                <Label htmlFor="method">Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                  <SelectTrigger id="method" data-testid="select-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                    <SelectItem value="PATCH">PATCH</SelectItem>
                    <SelectItem value="DELETE">DELETE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="path">Path</Label>
                <Input
                  id="path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/sheets"
                  data-testid="input-path"
                />
              </div>
            </div>

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
