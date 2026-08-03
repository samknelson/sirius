import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { getApiErrorMessage } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Server, AlertTriangle, CheckCircle, Database, Copy, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SystemMode } from "@/lib/system-types";
import { useSystemMode, useSetVariable } from "@/lib/use-variable";

interface DatabaseSourceInfo {
  host: string;
  database: string;
  source: "EXTERNAL_DATABASE_URL" | "DATABASE_URL";
  driver: "neon" | "pg";
  neonEndpointId: string | null;
  poolerRewritten: boolean;
}

function DatabaseSourceCard() {
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isError } = useQuery<{ database: DatabaseSourceInfo }>({
    queryKey: ["/api/admin/system-info"],
  });
  const info = data?.database;

  const copyEndpointId = async () => {
    if (!info?.neonEndpointId) return;
    await navigator.clipboard.writeText(info.neonEndpointId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Database Source
        </CardTitle>
        <CardDescription>
          Read-only view of which database this deployment is connected to
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-6 w-1/3" />
          </div>
        ) : isError || !info ? (
          <p className="text-sm text-destructive" data-testid="text-db-info-error">
            Failed to load database source information.
          </p>
        ) : (
          <div className="space-y-4">
            {info.neonEndpointId && (
              <div className="flex items-center gap-2 rounded-md border-2 border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-600 p-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Neon endpoint ID</p>
                  <p className="font-mono text-lg font-semibold" data-testid="text-neon-endpoint-id">
                    {info.neonEndpointId}
                  </p>
                  {info.poolerRewritten && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Rewritten from the <span className="font-mono">-pooler</span> endpoint to the direct endpoint
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyEndpointId}
                  data-testid="button-copy-endpoint-id"
                  aria-label="Copy Neon endpoint ID"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            )}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Host</dt>
                <dd className="font-mono break-all" data-testid="text-db-host">{info.host}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Database</dt>
                <dd className="font-mono" data-testid="text-db-name">{info.database}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Connection string source</dt>
                <dd data-testid="text-db-source">
                  <Badge variant="secondary" className="font-mono">{info.source}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Driver</dt>
                <dd data-testid="text-db-driver">
                  <Badge variant="secondary">
                    {info.driver === "neon" ? "Neon serverless (WebSocket)" : "node-postgres (TCP)"}
                  </Badge>
                </dd>
              </div>
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const modeDescriptions: Record<SystemMode, { label: string; description: string; color: string }> = {
  dev: {
    label: "Development",
    description: "Development mode - safe for testing without affecting real data or services",
    color: "bg-gray-100 border-gray-300 dark:bg-gray-800 dark:border-gray-600",
  },
  test: {
    label: "Test",
    description: "Test mode - for validation and staging before going live",
    color: "bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-600",
  },
  live: {
    label: "Live",
    description: "Live mode - production environment with real transactions and data",
    color: "bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-600",
  },
};

export default function SystemModePage() {
  usePageTitle("System Mode");
  const { toast } = useToast();

  const { mode: currentMode, isLoading } = useSystemMode();

  const updateModeMutation = useSetVariable("system_mode", {
    onSuccess: () => {
      toast({
        title: "System Mode Updated",
        description: "System mode has been changed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to update system mode"),
        variant: "destructive",
      });
    },
  });

  const handleModeChange = (mode: string) => {
    updateModeMutation.mutate(mode as SystemMode);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl md:text-2xl font-bold" data-testid="heading-system-mode">System Mode</h2>
        <p className="text-muted-foreground mt-1">
          Control the application's operating mode to manage behavior across different environments
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Select System Mode
          </CardTitle>
          <CardDescription>
            The system mode affects how the application behaves and whether certain operations are enabled
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <RadioGroup
              value={currentMode}
              onValueChange={handleModeChange}
              className="space-y-4"
              disabled={updateModeMutation.isPending}
            >
              {(Object.keys(modeDescriptions) as SystemMode[]).map((mode) => {
                const { label, description, color } = modeDescriptions[mode];
                const isSelected = currentMode === mode;
                
                return (
                  <div
                    key={mode}
                    className={`relative flex items-start gap-4 p-4 rounded-md border-2 transition-colors ${
                      isSelected ? color : "border-transparent bg-muted/30"
                    }`}
                  >
                    <RadioGroupItem
                      value={mode}
                      id={`mode-${mode}`}
                      className="mt-1"
                      data-testid={`radio-mode-${mode}`}
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor={`mode-${mode}`}
                        className="text-base font-medium cursor-pointer flex items-center gap-2"
                      >
                        {label}
                        {isSelected && (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                        {mode === "live" && (
                          <span className="inline-flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                            <AlertTriangle className="h-3 w-3" />
                            Production
                          </span>
                        )}
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      <DatabaseSourceCard />
    </div>
  );
}
