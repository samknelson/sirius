import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Play, Loader2, CheckCircle2, XCircle, Clock, Zap } from "lucide-react";
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

interface FetchResult {
  success: boolean;
  action: string;
  data?: unknown;
  error?: string;
  timestamp: string;
  durationMs: number;
}

const ACTIONS = [
  { value: "ping", label: "Ping", description: "Test connectivity to the T631 server" },
] as const;

export default function T631FetchPage() {
  usePageTitle("Teamsters 631 Fetch");
  const { toast } = useToast();
  const [action, setAction] = useState("ping");
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
            <div className="space-y-2">
              <Label htmlFor="action-select">Action</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger id="action-select" className="w-[200px]" data-testid="select-action">
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

          {ACTIONS.find((a) => a.value === action) && (
            <p className="text-sm text-muted-foreground">
              {ACTIONS.find((a) => a.value === action)?.description}
            </p>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
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
            </CardTitle>
            <CardDescription className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {result.durationMs}ms
              </span>
              <span>{result.timestamp}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.error && (
              <div className="mb-4 text-sm text-red-600 dark:text-red-400" data-testid="text-error">
                {result.error}
              </div>
            )}
            {result.data !== undefined && (
              <pre
                className="rounded-md bg-muted p-4 text-sm overflow-auto max-h-96"
                data-testid="text-response-data"
              >
                {JSON.stringify(result.data, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
