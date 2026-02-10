import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Settings, Info, CheckCircle2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ConfigureStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface CardcheckDefinition {
  id: string;
  siriusId: string;
  name: string;
  description?: string;
}

export function ConfigureStep({ wizardId, wizardType, data, onDataChange }: ConfigureStepProps) {
  const { toast } = useToast();

  const [cardcheckDefinitionId, setCardcheckDefinitionId] = useState<string>(data?.cardcheckDefinitionId || '');
  const [isSaving, setIsSaving] = useState(false);

  const { data: definitions, isLoading: loadingDefinitions } = useQuery<CardcheckDefinition[]>({
    queryKey: ['/api/cardcheck/definitions'],
  });

  useEffect(() => {
    if (data?.cardcheckDefinitionId) {
      setCardcheckDefinitionId(data.cardcheckDefinitionId);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (config: { cardcheckDefinitionId: string }) => {
      return await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: {
          cardcheckDefinitionId: config.cardcheckDefinitionId,
          progress: {
            configure: {
              status: "completed",
              completedAt: new Date().toISOString(),
            },
          },
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Configuration Saved",
        description: "Card check definition selected.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = async () => {
    if (!cardcheckDefinitionId) {
      toast({
        title: "Missing Selection",
        description: "Please select a card check type.",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({ cardcheckDefinitionId });
    } finally {
      setIsSaving(false);
    }
  };

  const isConfigComplete = !!data?.cardcheckDefinitionId;
  const selectedDefinition = definitions?.find((d: CardcheckDefinition) => d.id === (data?.cardcheckDefinitionId || cardcheckDefinitionId));

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
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cardcheckDefinition">Card Check Type</Label>
              {loadingDefinitions ? (
                <div className="text-sm text-muted-foreground" data-testid="text-loading-definitions">Loading card check types...</div>
              ) : (
                <Select
                  value={cardcheckDefinitionId}
                  onValueChange={setCardcheckDefinitionId}
                >
                  <SelectTrigger data-testid="select-cardcheck-definition">
                    <SelectValue placeholder="Select a card check type" />
                  </SelectTrigger>
                  <SelectContent>
                    {definitions?.map((def: CardcheckDefinition) => (
                      <SelectItem key={def.id} value={def.id} data-testid={`select-item-${def.siriusId}`}>
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
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>How the scraper import works</AlertTitle>
            <AlertDescription>
              The scraper will log in to the external BTU site, scrape signed card check records,
              match them to workers by BPS Employee ID, generate PDFs, and create card check records.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSave}
              disabled={isSaving || !cardcheckDefinitionId}
              data-testid="button-save-config"
            >
              {isSaving ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isConfigComplete && selectedDefinition && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-lg" data-testid="text-config-saved">Configuration saved</span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              <p>Card Check Type: <strong data-testid="text-selected-definition">{selectedDefinition.name}</strong></p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
