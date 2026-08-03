import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface ContextInfo {
  id: string;
  label: string;
  component: string | null;
  componentEnabled: boolean;
  tokens: string[];
  config: { file_system: string; directory: string; allowed?: string[] } | null;
}

interface ContextsResponse {
  contexts: ContextInfo[];
  fileSystems: { id: string; access: string }[];
}

interface DraftEntry {
  enabled: boolean;
  file_system: string;
  directory: string;
  allowed: string;
}

const VARIABLE_NAME = "entity_files_config";

export default function EntityFilesConfigPage() {
  usePageTitle("Entity Files");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<ContextsResponse>({
    queryKey: ["/api/entity-files/contexts"],
  });

  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({});

  useEffect(() => {
    if (!data) return;
    const next: Record<string, DraftEntry> = {};
    for (const context of data.contexts) {
      next[context.id] = {
        enabled: !!context.config,
        file_system: context.config?.file_system ?? "",
        directory: context.config?.directory ?? "",
        allowed: context.config?.allowed?.join(", ") ?? "",
      };
    }
    setDrafts(next);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const value: Record<string, { file_system: string; directory: string; allowed?: string[] }> = {};
      for (const [contextId, draft] of Object.entries(drafts)) {
        if (!draft.enabled) continue;
        const allowed = draft.allowed
          .split(",")
          .map((e) => e.trim().replace(/^\./, "").toLowerCase())
          .filter(Boolean);
        value[contextId] = {
          file_system: draft.file_system,
          directory: draft.directory.trim(),
          ...(allowed.length > 0 ? { allowed } : {}),
        };
      }
      return apiRequest("PUT", `/api/variables/by-name/${VARIABLE_NAME}`, { value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/entity-files/contexts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/variables/by-name", VARIABLE_NAME] });
      toast({ title: "Configuration saved" });
    },
    onError: (error) => {
      toast({
        title: "Save failed",
        description: getApiErrorMessage(error, "Request failed"),
        variant: "destructive",
      });
    },
  });

  const setDraft = (contextId: string, patch: Partial<DraftEntry>) =>
    setDrafts((prev) => ({ ...prev, [contextId]: { ...prev[contextId], ...patch } }));

  const invalid = Object.values(drafts).some(
    (d) => d.enabled && (!d.file_system || !d.directory.trim()),
  );

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2" data-testid="heading-entity-files">
          <FolderOpen className="h-7 w-7" />
          Entity Files
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure where file attachments are stored for each area of the app. An area with
          no configuration will not accept uploads.
        </p>
      </div>

      {data.contexts.length === 0 && (
        <p className="text-muted-foreground" data-testid="text-no-contexts">
          No areas support file attachments yet.
        </p>
      )}

      {data.contexts.map((context) => {
        const draft = drafts[context.id];
        if (!draft) return null;
        return (
          <Card key={context.id} data-testid={`card-context-${context.id}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{context.label}</CardTitle>
                  <CardDescription>
                    {context.component && !context.componentEnabled
                      ? `Component "${context.component}" is disabled — this area is currently hidden.`
                      : context.tokens.length > 0
                        ? `Directory tokens available: ${context.tokens.join(", ")}`
                        : "No directory tokens available."}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`enabled-${context.id}`} className="text-sm text-muted-foreground">
                    Configured
                  </Label>
                  <Switch
                    id={`enabled-${context.id}`}
                    checked={draft.enabled}
                    onCheckedChange={(checked) => setDraft(context.id, { enabled: checked })}
                    data-testid={`switch-enabled-${context.id}`}
                  />
                </div>
              </div>
            </CardHeader>
            {draft.enabled && (
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Filesystem</Label>
                    <Select
                      value={draft.file_system || undefined}
                      onValueChange={(value) => setDraft(context.id, { file_system: value })}
                    >
                      <SelectTrigger data-testid={`select-filesystem-${context.id}`}>
                        <SelectValue placeholder="Choose a filesystem" />
                      </SelectTrigger>
                      <SelectContent>
                        {data.fileSystems.map((fs) => (
                          <SelectItem key={fs.id} value={fs.id}>
                            {fs.id} ({fs.access})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Directory</Label>
                    <Input
                      value={draft.directory}
                      onChange={(e) => setDraft(context.id, { directory: e.target.value })}
                      placeholder={
                        context.tokens[0]
                          ? `e.g. grievances/${context.tokens[0]}`
                          : "e.g. attachments"
                      }
                      data-testid={`input-directory-${context.id}`}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Allowed extensions (optional, comma-separated)</Label>
                  <Input
                    value={draft.allowed}
                    onChange={(e) => setDraft(context.id, { allowed: e.target.value })}
                    placeholder="e.g. pdf, docx, png — leave empty to allow all"
                    data-testid={`input-allowed-${context.id}`}
                  />
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}

      {data.contexts.length > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || invalid}
            data-testid="button-save-entity-files"
          >
            {saveMutation.isPending ? "Saving…" : "Save Configuration"}
          </Button>
        </div>
      )}
    </div>
  );
}
