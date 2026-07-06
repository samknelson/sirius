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
import { AlertCircle, CheckCircle2 } from "lucide-react";
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
 * `configure` step for the BTU card check import wizard. Reads the current
 * selection through the fixed dispatcher `getData` route and writes it back
 * via `submit`. The definition options come from the existing generic
 * `GET /api/cardcheck/definitions` route — no wizard-specific endpoint.
 */
export function CardcheckConfigure({ wizardId, step }: WizardStepComponentProps) {
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
        title: "Definition Selected",
        description: "You can proceed to the next step.",
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{step.name}</CardTitle>
        <CardDescription>
          Choose the card check definition these records belong to.
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
            <Label htmlFor="cardcheck-definition">Card Check Definition</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger
                id="cardcheck-definition"
                data-testid="select-cardcheck-definition"
              >
                <SelectValue placeholder="Select a definition…" />
              </SelectTrigger>
              <SelectContent>
                {definitions.map((def) => (
                  <SelectItem key={def.id} value={def.id}>
                    {def.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selected && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Definition selected</AlertTitle>
            <AlertDescription>Save to continue.</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!selected || saveMutation.isPending}
            data-testid="button-save-configure"
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
