import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Settings, Info, CheckCircle2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface CardcheckDefinition {
  id: string;
  siriusId: string;
  name: string;
  description?: string;
}

interface ConfigureData {
  cardcheckDefinitionId: string | null;
}

/**
 * `configure` step for the BTU scraper import wizard. Reads/writes the
 * selected card check definition through the fixed dispatcher `getData` /
 * `submit` routes. Definition options come from the existing generic
 * `GET /api/cardcheck/definitions` route — no wizard-specific endpoint.
 */
export function ScrapeConfigure({ wizardId, step }: WizardStepComponentProps) {
  const { toast } = useToast();

  const { data: current, isLoading } = useQuery<ConfigureData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  const { data: definitions = [], isLoading: loadingDefinitions } = useQuery<
    CardcheckDefinition[]
  >({
    queryKey: ["/api/cardcheck/definitions"],
  });

  const [selected, setSelected] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!current || hydrated) return;
    setSelected(current.cardcheckDefinitionId ?? "");
    setHydrated(true);
  }, [current, hydrated]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: { cardcheckDefinitionId: selected },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      queryClient.invalidateQueries({
        queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
      });
      toast({
        title: "Configuration Saved",
        description: "Card check definition selected.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Save Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const selectedDefinition = definitions.find((d) => d.id === selected);
  const isConfigComplete = !!current?.cardcheckDefinitionId;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Import Configuration
          </CardTitle>
          <CardDescription>
            Select which card check type to associate with scraped card checks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2 max-w-md">
            <Label htmlFor="cardcheck-definition">Card Check Type</Label>
            {isLoading || loadingDefinitions ? (
              <div
                className="text-sm text-muted-foreground"
                data-testid="text-loading-definitions"
              >
                Loading card check types...
              </div>
            ) : (
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger
                  id="cardcheck-definition"
                  data-testid="select-cardcheck-definition"
                >
                  <SelectValue placeholder="Select a card check type" />
                </SelectTrigger>
                <SelectContent>
                  {definitions.map((def) => (
                    <SelectItem
                      key={def.id}
                      value={def.id}
                      data-testid={`select-item-${def.siriusId}`}
                    >
                      {def.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-sm text-muted-foreground">
              All scraped card checks will be linked to this card check type.
            </p>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>How the scraper import works</AlertTitle>
            <AlertDescription>
              This tool finds card checks that have a NID (from a prior import)
              but are missing a signature PDF. It fetches the PDF from the
              external BTU site by NID and creates an e-signature record for
              each.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!selected || saveMutation.isPending}
              data-testid="button-save-config"
            >
              {saveMutation.isPending ? "Saving…" : "Save Configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isConfigComplete && selectedDefinition && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-lg" data-testid="text-config-saved">
                Configuration saved
              </span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              <p>
                Card Check Type:{" "}
                <strong data-testid="text-selected-definition">
                  {selectedDefinition.name}
                </strong>
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
