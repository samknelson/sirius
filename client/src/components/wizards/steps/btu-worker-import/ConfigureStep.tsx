import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calendar, AlertTriangle, Info } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface ConfigureStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

export function ConfigureStep({ wizardId, wizardType, data, onDataChange }: ConfigureStepProps) {
  const { toast } = useToast();
  const today = format(new Date(), 'yyyy-MM-dd');
  
  const [asOfDate, setAsOfDate] = useState<string>(data?.asOfDate || today);
  const [terminateByAbsence, setTerminateByAbsence] = useState<boolean>(data?.terminateByAbsence ?? true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (data?.asOfDate) {
      setAsOfDate(data.asOfDate);
    }
    if (data?.terminateByAbsence !== undefined) {
      setTerminateByAbsence(data.terminateByAbsence);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (config: { asOfDate: string; terminateByAbsence: boolean }) => {
      return await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: {
          asOfDate: config.asOfDate,
          terminateByAbsence: config.terminateByAbsence,
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
        description: "Import options have been saved successfully.",
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
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({ asOfDate, terminateByAbsence });
    } finally {
      setIsSaving(false);
    }
  };

  const isConfigComplete = !!data?.asOfDate;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Import Configuration
          </CardTitle>
          <CardDescription>
            Set the effective date and options for this worker import
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="asOfDate">As-Of Date</Label>
              <Input
                id="asOfDate"
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                data-testid="input-as-of-date"
              />
              <p className="text-sm text-muted-foreground">
                Employment records will be created with this effective date. This represents when the worker roster was generated.
              </p>
            </div>
            
            <div className="flex items-center space-x-3 pt-4">
              <Checkbox
                id="terminateByAbsence"
                checked={terminateByAbsence}
                onCheckedChange={(checked) => setTerminateByAbsence(checked === true)}
                data-testid="checkbox-terminate-by-absence"
              />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor="terminateByAbsence" className="cursor-pointer">
                  Terminate by absence
                </Label>
                <p className="text-sm text-muted-foreground">
                  Create termination records for workers who are currently active but not present in this import file
                </p>
              </div>
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>About Termination by Absence</AlertTitle>
            <AlertDescription>
              When enabled, workers with active employment who are not included in this roster file
              will have their employment terminated with an effective date matching the as-of date.
              This helps keep employment records synchronized with payroll data.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSave}
              disabled={isSaving || !asOfDate}
              data-testid="button-save-config"
            >
              {isSaving ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isConfigComplete && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <span className="text-lg">Configuration saved successfully</span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              <p>As-Of Date: <strong>{format(new Date(data.asOfDate), 'MMMM d, yyyy')}</strong></p>
              <p>Terminate by Absence: <strong>{data.terminateByAbsence ? 'Yes' : 'No'}</strong></p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
