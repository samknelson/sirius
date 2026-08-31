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

interface WorkerIdType {
  id: string;
  name: string;
}

interface ConfigureData {
  workerIdentifierKind: string | null;
}

/** Mirrors `WORKER_ID_TYPE_PREFIX` in the server engine class. */
const ID_TYPE_PREFIX = "id-type:";

const BUILT_IN_KINDS: Array<{ value: string; label: string }> = [
  { value: "ssn", label: "SSN" },
  { value: "uuid", label: "Worker UUID" },
  { value: "sirius", label: "Sirius ID" },
];

/**
 * `configure` step for the worker ratings import wizard: which kind of
 * identifier the file's single worker column holds. Reads the current choice
 * through the fixed dispatcher `getData` route and writes it back via
 * `submit`. The site's configured worker ID types are listed live from the
 * existing generic `GET /api/options/worker-id-type` route — no wizard
 * specific endpoint, and nothing about them is hardcoded here.
 */
export function RatingsConfigure({ wizardId, step }: WizardStepComponentProps) {
  const { toast } = useToast();

  const { data: current, isLoading } = useQuery<ConfigureData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  const {
    data: idTypes = [],
    isLoading: idTypesLoading,
    isError: idTypesFailed,
  } = useQuery<WorkerIdType[]>({
    queryKey: ["/api/options/worker-id-type"],
  });

  const [selected, setSelected] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!current || hydrated) return;
    setSelected(current.workerIdentifierKind ?? "");
    setHydrated(true);
  }, [current, hydrated]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: { workerIdentifierKind: selected },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      queryClient.invalidateQueries({
        queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
      });
      toast({
        title: "Identifier Selected",
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

  if (isLoading || idTypesLoading) {
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
          Choose what the worker column in your file holds. Every row is looked
          up this one way.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {idTypesFailed && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Could not load worker ID types</AlertTitle>
            <AlertDescription>
              The site's configured ID types are unavailable, so only SSN,
              worker UUID and Sirius ID are offered below.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 max-w-md">
          <Label htmlFor="worker-identifier-kind">Worker Identified By</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger
              id="worker-identifier-kind"
              data-testid="select-worker-identifier-kind"
            >
              <SelectValue placeholder="Select an identifier…" />
            </SelectTrigger>
            <SelectContent>
              {BUILT_IN_KINDS.map((kind) => (
                <SelectItem
                  key={kind.value}
                  value={kind.value}
                  data-testid={`option-identifier-${kind.value}`}
                >
                  {kind.label}
                </SelectItem>
              ))}
              {idTypes.map((type) => (
                <SelectItem
                  key={type.id}
                  value={`${ID_TYPE_PREFIX}${type.id}`}
                  data-testid={`option-identifier-id-type-${type.id}`}
                >
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selected && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Identifier selected</AlertTitle>
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
