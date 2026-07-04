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
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface CardcheckDefinition {
  id: string;
  name: string;
}

interface ConfigureData {
  cardcheckDefinitionId: string | null;
}

/**
 * `configure` step for the BTU signature import wizard. Reads the current
 * selection through the fixed dispatcher `getData` route and writes it back
 * via `submit`. The definition options come from the existing generic
 * `GET /api/cardcheck/definitions` route — no wizard-specific endpoint.
 */
export function SigConfigure({ wizardId, step }: WizardStepComponentProps) {
  const { toast } = useToast();

  const { data: current, isLoading } = useQuery<ConfigureData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  const { data: definitions = [], isLoading: defsLoading } = useQuery<
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

  if (isLoading || defsLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </CardContent>
      </Card>
    );
  }

  const selectedDefinition = definitions.find((d) => d.id === selected);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{step.name}</CardTitle>
          <CardDescription>
            Select which card check type to associate with imported signatures.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {definitions.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No card check definitions</AlertTitle>
              <AlertDescription>
                Create a card check definition first, then return to this step.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2 max-w-md">
              <Label htmlFor="cardcheck-definition">Card Check Type</Label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger
                  id="cardcheck-definition"
                  data-testid="select-cardcheck-definition"
                >
                  <SelectValue placeholder="Select a card check type" />
                </SelectTrigger>
                <SelectContent>
                  {definitions.map((def) => (
                    <SelectItem key={def.id} value={def.id}>
                      {def.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                All imported signatures will be linked to card checks of this
                type.
              </p>
            </div>
          )}

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>How the signature import works</AlertTitle>
            <AlertDescription>
              Each PDF in the ZIP file will be matched to a worker by BPS
              Employee ID extracted from the filename. For each matched file, an
              offline e-signature record will be created and linked to the
              worker's card check. If no card check exists, one will be created
              with "signed" status.
            </AlertDescription>
          </Alert>

          {selected && selectedDefinition && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Definition selected</AlertTitle>
              <AlertDescription>
                Card Check Type: <strong>{selectedDefinition.name}</strong>. Save
                to continue.
              </AlertDescription>
            </Alert>
          )}

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
    </div>
  );
}
