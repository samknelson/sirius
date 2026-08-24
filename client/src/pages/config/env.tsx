import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Lock, Pencil, Trash2, Info, Search, RotateCw, RefreshCw, Zap } from "lucide-react";

interface EnvVarInfo {
  name: string;
  description: string;
  secret: boolean;
  category: string;
  required: boolean;
  isSet: boolean;
  source: "environment" | "override" | null;
  overridable: boolean;
  value: string | null;
  hasShadowedOverride: boolean;
  released: boolean;
  /**
   * When a change is picked up by the running app. null when the variable's
   * declaration does not state it — show nothing rather than implying
   * "immediate". "reload" means a subsystem on the Restart & Reload page can
   * re-read it in place, so no restart is needed.
   */
  changeTakesEffect: "immediate" | "restart" | "reload" | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  core: "Core",
  auth: "Authentication",
  integrations: "Integrations",
  platform: "Platform",
  dev: "Development",
};

export default function EnvPage() {
  usePageTitle("Environment Variables");
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");

  const { data: vars, isLoading } = useQuery<EnvVarInfo[]>({
    queryKey: ["/api/admin/env"],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/env"] });

  const setMutation = useMutation({
    mutationFn: async ({ name, value }: { name: string; value: string }) =>
      apiRequest("PUT", `/api/admin/env/${encodeURIComponent(name)}`, { value }),
    onSuccess: () => {
      setEditing(null);
      setDraft("");
      invalidate();
      toast({ title: "Override saved" });
    },
    onError: (error) =>
      toast({
        title: "Failed to save override",
        description: getApiErrorMessage(error, "Request failed"),
        variant: "destructive",
      }),
  });

  const clearMutation = useMutation({
    mutationFn: async (name: string) =>
      apiRequest("DELETE", `/api/admin/env/${encodeURIComponent(name)}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Override cleared" });
    },
    onError: (error) =>
      toast({
        title: "Failed to clear override",
        description: getApiErrorMessage(error, "Request failed"),
        variant: "destructive",
      }),
  });

  useEffect(() => {
    if (editing && !vars?.some((v) => v.name === editing)) setEditing(null);
  }, [vars, editing]);

  const needle = filter.trim().toLowerCase();
  const filtered = (vars ?? []).filter(
    (v) =>
      needle === "" ||
      v.name.toLowerCase().includes(needle) ||
      v.description.toLowerCase().includes(needle),
  );
  const categories = Array.from(new Set(filtered.map((v) => v.category)));

  return (
    <div className="space-y-6" data-testid="page-config-env">
      <div>
        <h1 className="text-2xl font-semibold">Environment Variables</h1>
        <p className="text-muted-foreground mt-1">
          View registered environment variables and set in-app overrides.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Values set in the real environment are locked and always win over
          overrides. To release a stale deployment variable, set it to{" "}
          <code className="font-mono">__UNSET__</code> (or empty) in the
          deployment settings — the app then treats it as not set. When a
          variable says when its changes are picked up, that is shown on the
          variable itself: <em>applies immediately</em> means the next use
          reads the new value, <em>restart to apply</em> means the app reads it
          only while starting. Variables that say neither have not been
          classified.
        </AlertDescription>
      </Alert>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name…"
          className="pl-8"
          data-testid="env-filter"
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!isLoading && needle !== "" && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="env-filter-empty">
          No matching variables.
        </p>
      )}

      {categories.map((category) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle>{CATEGORY_LABELS[category] ?? category}</CardTitle>
            <CardDescription>
              {filtered.filter((v) => v.category === category).length} variables
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {filtered
              .filter((v) => v.category === category)
              .map((v) => {
                const isEditing = editing === v.name;
                const envLocked = v.source === "environment";
                return (
                  <div key={v.name} className="py-3" data-testid={`env-row-${v.name}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-medium">{v.name}</span>
                          {v.required && <Badge variant="outline">required</Badge>}
                          {v.secret && <Badge variant="outline">secret</Badge>}
                          {envLocked && (
                            <Badge variant="secondary" className="gap-1">
                              <Lock className="h-3 w-3" /> environment
                            </Badge>
                          )}
                          {v.source === "override" && <Badge>override</Badge>}
                          {v.released && <Badge variant="outline">released</Badge>}
                          {!v.isSet && <Badge variant="destructive">unset</Badge>}
                          {/* Advisory only, and only when the declaration
                              states it — an unstated variable shows nothing
                              rather than being presented as immediate. */}
                          {v.changeTakesEffect === "restart" && (
                            <Badge
                              variant="outline"
                              className="gap-1"
                              data-testid={`env-effect-restart-${v.name}`}
                            >
                              <RotateCw className="h-3 w-3" /> restart to apply
                            </Badge>
                          )}
                          {v.changeTakesEffect === "immediate" && (
                            <Badge
                              variant="outline"
                              className="gap-1"
                              data-testid={`env-effect-immediate-${v.name}`}
                            >
                              <Zap className="h-3 w-3" /> applies immediately
                            </Badge>
                          )}
                          {v.changeTakesEffect === "reload" && (
                            <Badge
                              variant="outline"
                              className="gap-1"
                              data-testid={`env-effect-reload-${v.name}`}
                            >
                              <RefreshCw className="h-3 w-3" /> reload to apply
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{v.description}</p>
                        {!v.secret && v.isSet && v.value !== null && (
                          <p className="font-mono text-xs mt-1 break-all text-muted-foreground">
                            {v.value}
                          </p>
                        )}
                        {v.released && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Released in deployment settings (empty or __UNSET__) — treated as
                            not set.
                          </p>
                        )}
                        {/* About WHEN a change is picked up — separate from the
                            deployment-lock notes below, which are about WHICH
                            value wins. */}
                        {v.changeTakesEffect === "restart" && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                            <RotateCw className="h-3 w-3 mt-0.5 shrink-0" />
                            Read once while the app starts — saving a new value here does not
                            change the running app until it is restarted.
                          </p>
                        )}
                        {v.changeTakesEffect === "reload" && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                            <RefreshCw className="h-3 w-3 mt-0.5 shrink-0" />
                            Read once while the app starts, but a subsystem can re-read it in
                            place — apply a new value from Restart &amp; Reload, no restart
                            needed.
                          </p>
                        )}
                        {envLocked && v.overridable && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                            <Lock className="h-3 w-3 mt-0.5 shrink-0" />
                            Set in the deployment environment — that value wins. To manage it
                            here, set it to <code className="font-mono">__UNSET__</code> (or
                            empty) in your deployment settings, then restart the app.
                          </p>
                        )}
                        {envLocked && !v.overridable && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                            <Lock className="h-3 w-3 mt-0.5 shrink-0" />
                            Set in the deployment environment and managed there only — this
                            variable cannot be overridden in-app.
                          </p>
                        )}
                        {!v.overridable && !envLocked && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                            <Lock className="h-3 w-3 mt-0.5 shrink-0" />
                            Managed through the deployment pipeline only — cannot be overridden
                            in-app.
                          </p>
                        )}
                        {v.hasShadowedOverride && (
                          <p className="text-xs text-amber-600 mt-1">
                            A stored override exists but is shadowed by the environment value.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {v.overridable && !envLocked && !isEditing && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditing(v.name);
                              setDraft(v.secret ? "" : (v.value ?? ""));
                            }}
                            data-testid={`env-edit-${v.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            {v.source === "override" ? "Edit" : "Set"}
                          </Button>
                        )}
                        {v.source === "override" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => clearMutation.mutate(v.name)}
                            disabled={clearMutation.isPending}
                            data-testid={`env-clear-${v.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                    {isEditing && (
                      <div className="flex items-center gap-2 mt-2">
                        <Input
                          type={v.secret ? "password" : "text"}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder={v.secret ? "New secret value" : "Value"}
                          className="font-mono text-sm"
                          data-testid={`env-input-${v.name}`}
                        />
                        <Button
                          size="sm"
                          onClick={() => setMutation.mutate({ name: v.name, value: draft })}
                          disabled={setMutation.isPending || draft === ""}
                          data-testid={`env-save-${v.name}`}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(null);
                            setDraft("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
