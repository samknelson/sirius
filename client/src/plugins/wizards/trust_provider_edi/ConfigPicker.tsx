import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface EdiConfigOption {
  configId: string;
  pluginId: string;
  pluginName: string;
  name: string | null;
  providerId: string | null;
  sftpClientId: string | null;
}

interface ConfigStepData {
  configs: EdiConfigOption[];
  selected: { configId: string } | null;
}

/**
 * First step of the trust-provider EDI wizard: pick which enabled EDI
 * configuration (file type + provider + SFTP destination) to generate.
 */
export function ConfigPicker({ wizardId, step }: WizardStepComponentProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dataUrl = `/api/wizards/${wizardId}/dispatch/${step.id}/data`;
  const { data, isLoading } = useQuery<ConfigStepData>({ queryKey: [dataUrl] });
  const [choice, setChoice] = useState<string | null>(null);

  const selectedId = choice ?? data?.selected?.configId ?? null;

  const submitMutation = useMutation({
    mutationFn: async (configId: string) =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: { configId },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      queryClient.invalidateQueries({ queryKey: [dataUrl] });
    },
    onError: (error) => {
      toast({
        title: "Could not select configuration",
        description: getApiErrorMessage(error, "Failed to select configuration"),
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-6 w-1/3" />
        </CardContent>
      </Card>
    );
  }

  const configs = data?.configs ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>EDI Configuration</CardTitle>
        <CardDescription>
          Pick which EDI file configuration to generate. Changing the
          selection resets any previously generated results.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {configs.length === 0 ? (
          <div className="flex items-center gap-3 text-muted-foreground p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <span data-testid="text-no-configs">
              No enabled EDI configurations found. Create one under Config →
              Plugins → Trust Provider EDI.
            </span>
          </div>
        ) : (
          <RadioGroup
            value={selectedId ?? ""}
            onValueChange={(v) => setChoice(v)}
            className="space-y-2"
          >
            {configs.map((c) => (
              <div
                key={c.configId}
                className="flex items-center space-x-3 rounded-md border p-3"
                data-testid={`row-config-${c.configId}`}
              >
                <RadioGroupItem value={c.configId} id={c.configId} />
                <Label htmlFor={c.configId} className="flex-1 cursor-pointer">
                  <span className="font-medium">{c.name || c.pluginName}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {c.pluginName}
                  </span>
                </Label>
                {!c.sftpClientId && (
                  <Badge variant="outline" data-testid={`badge-no-sftp-${c.configId}`}>
                    No SFTP destination
                  </Badge>
                )}
              </div>
            ))}
          </RadioGroup>
        )}
        <Button
          onClick={() => selectedId && submitMutation.mutate(selectedId)}
          disabled={!selectedId || submitMutation.isPending}
          data-testid="button-select-config"
        >
          {submitMutation.isPending ? "Saving..." : "Use This Configuration"}
        </Button>
      </CardContent>
    </Card>
  );
}
