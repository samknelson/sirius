import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface ContextInfo {
  id: string;
  label: string;
  recordLabel: string;
  component: string | null;
  componentEnabled: boolean;
  enabled: boolean;
}

interface ContextsResponse {
  contexts: ContextInfo[];
}

const VARIABLE_NAME = "entity_notes_config";

/**
 * Config → Entity Notes: which areas of the app carry staff notes.
 *
 * The twin of Config → Entity Files, minus the storage settings notes do not
 * have: a note is a row, so being switched on is the whole configuration.
 */
export default function EntityNotesConfigPage() {
  usePageTitle("Entity Notes");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<ContextsResponse>({
    queryKey: ["/api/entity-notes/contexts"],
  });

  const [drafts, setDrafts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!data) return;
    const next: Record<string, boolean> = {};
    for (const context of data.contexts) {
      next[context.id] = context.enabled;
    }
    setDrafts(next);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Presence is the setting: an area that is on gets an (empty) entry, an
      // area that is off is simply absent.
      const value: Record<string, Record<string, never>> = {};
      for (const [contextId, enabled] of Object.entries(drafts)) {
        if (enabled) value[contextId] = {};
      }
      return apiRequest("PUT", `/api/variables/by-name/${VARIABLE_NAME}`, { value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/entity-notes/contexts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/variables/by-name", VARIABLE_NAME] });
      // The Notes tabs are hidden or shown by this setting; their access
      // answers are cached per record.
      queryClient.invalidateQueries({ queryKey: ["/api/access/tabs"] });
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
        <h1
          className="text-2xl md:text-3xl font-bold flex items-center gap-2"
          data-testid="heading-entity-notes"
        >
          <NotebookPen className="h-7 w-7" />
          Entity Notes
        </h1>
        <p className="text-muted-foreground mt-2">
          Choose which areas of the app carry staff notes. An area that is switched off
          hides its Notes tab and refuses note requests; notes already written there are
          kept and reappear when it is switched back on. Which note types apply to which
          area is set under Dropdown Lists → Note Types.
        </p>
      </div>

      {data.contexts.length === 0 && (
        <p className="text-muted-foreground" data-testid="text-no-contexts">
          No areas support notes yet.
        </p>
      )}

      {data.contexts.map((context) => (
        <Card key={context.id} data-testid={`card-context-${context.id}`}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{context.label}</CardTitle>
                <CardDescription>
                  {context.component && !context.componentEnabled
                    ? `Component "${context.component}" is disabled — this area is currently hidden.`
                    : `Staff notes on each ${context.recordLabel.toLowerCase()}.`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor={`enabled-${context.id}`}
                  className="text-sm text-muted-foreground"
                >
                  Enabled
                </Label>
                <Switch
                  id={`enabled-${context.id}`}
                  checked={drafts[context.id] ?? false}
                  onCheckedChange={(checked) =>
                    setDrafts((prev) => ({ ...prev, [context.id]: checked }))
                  }
                  data-testid={`switch-enabled-${context.id}`}
                />
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}

      {data.contexts.length > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-entity-notes"
          >
            {saveMutation.isPending ? "Saving…" : "Save Configuration"}
          </Button>
        </div>
      )}
    </div>
  );
}
