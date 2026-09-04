import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Download, FileJson, AlertTriangle } from "lucide-react";
import { WsClientLayout, useWsClientLayout } from "@/components/layouts/WsClientLayout";

/** The parts of the generated document this screen reads. */
interface OpenApiDocument {
  openapi: string;
  info: { title?: string; version?: string; description?: string };
  servers?: { url: string; description?: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  requestBody?: unknown;
  responses?: Record<string, { content?: Record<string, unknown> }>;
}

/** Verb keys in a path item, in the order they should be shown. */
const METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;

interface FlatOperation {
  path: string;
  method: string;
  service: string;
  operation: OpenApiOperation;
  hasRequestSchema: boolean;
  hasResponseSchema: boolean;
}

/**
 * Flatten the document into one row per verb — the same unit the integrator
 * calls, and the same unit the document declares.
 */
function flatten(doc: OpenApiDocument | undefined): FlatOperation[] {
  if (!doc?.paths) return [];
  const rows: FlatOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHOD_ORDER) {
      const operation = item[method];
      if (!operation) continue;
      rows.push({
        path,
        method: method.toUpperCase(),
        service: operation.tags?.[0] ?? path,
        operation,
        hasRequestSchema: Boolean(operation.requestBody),
        hasResponseSchema: Boolean(operation.responses?.["200"]?.content),
      });
    }
  }
  return rows;
}

function SwaggerContent() {
  const params = useParams<{ id: string }>();
  const { client } = useWsClientLayout();

  const {
    data: document,
    isLoading,
    error,
  } = useQuery<OpenApiDocument>({
    queryKey: ["/api/admin/ws-clients", params.id, "openapi"],
    enabled: !!params.id,
  });

  const operations = useMemo(() => flatten(document), [document]);

  const grouped = useMemo(() => {
    const byService = new Map<string, FlatOperation[]>();
    for (const row of operations) {
      const list = byService.get(row.service) ?? [];
      list.push(row);
      byService.set(row.service, list);
    }
    return Array.from(byService.entries());
  }, [operations]);

  const download = () => {
    if (!document) return;
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${client.name.replace(/[^A-Za-z0-9._-]+/g, "-")}-openapi.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="loader-swagger" />
      </div>
    );
  }

  if (error || !document) {
    return (
      <Alert variant="destructive" data-testid="alert-swagger-error">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Failed to build the API document for this client.</AlertDescription>
      </Alert>
    );
  }

  const server = document.servers?.[0];

  return (
    <Card data-testid="card-swagger">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            API Document
          </CardTitle>
          <CardDescription>
            {operations.length > 0
              ? `${operations.length} operation${operations.length !== 1 ? "s" : ""} across ${grouped.length} service${grouped.length !== 1 ? "s" : ""} granted to this client.`
              : "This client is granted no callable service, so the document describes no endpoints."}
          </CardDescription>
        </div>
        <Button onClick={download} data-testid="button-download-openapi">
          <Download className="h-4 w-4 mr-2" />
          Download OpenAPI JSON
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-sm text-muted-foreground space-y-1" data-testid="text-swagger-server">
          <p>
            <span className="font-medium text-foreground">Base URL:</span> {server?.url ?? "—"}
            {server?.description ? ` — ${server.description}` : ""}
          </p>
          <p>
            <span className="font-medium text-foreground">Authentication:</span> X-WS-Client-Key and
            X-WS-Client-Secret headers, or HTTP Basic with the key as username and the secret as
            password. The document never contains a credential.
          </p>
        </div>

        {grouped.map(([service, rows]) => (
          <div key={service} className="space-y-3" data-testid={`section-service-${service}`}>
            <h3 className="text-base font-semibold text-foreground">{service}</h3>
            <div className="space-y-3">
              {rows.map((row) => (
                <div
                  key={`${row.method} ${row.path}`}
                  className="rounded-md border p-3 space-y-2"
                  data-testid={`row-operation-${row.operation.operationId ?? row.path}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono">
                      {row.method}
                    </Badge>
                    <code className="text-sm break-all">{row.path}</code>
                  </div>
                  {row.operation.description && (
                    <p className="text-sm text-muted-foreground whitespace-pre-line">
                      {row.operation.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs">
                    {["POST", "PUT", "PATCH"].includes(row.method) && (
                      <Badge variant={row.hasRequestSchema ? "outline" : "secondary"}>
                        {row.hasRequestSchema ? "Request described" : "Request not described"}
                      </Badge>
                    )}
                    <Badge variant={row.hasResponseSchema ? "outline" : "secondary"}>
                      {row.hasResponseSchema ? "Response described" : "Response not described"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function WsClientSwaggerPage() {
  return (
    <WsClientLayout activeTab="swagger">
      <SwaggerContent />
    </WsClientLayout>
  );
}
