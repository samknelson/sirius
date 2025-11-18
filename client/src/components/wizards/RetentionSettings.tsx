import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Clock } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RetentionSettingsProps {
  wizardId: string;
  currentRetention?: string;
}

const RETENTION_OPTIONS = [
  { value: '1day', label: '1 Day' },
  { value: '7days', label: '7 Days' },
  { value: '30days', label: '30 Days' },
  { value: '1year', label: '1 Year' },
  { value: 'always', label: 'Always' }
];

export function RetentionSettings({ wizardId, currentRetention = '30days' }: RetentionSettingsProps) {
  const { toast } = useToast();

  const updateRetentionMutation = useMutation({
    mutationFn: async (retention: string) => {
      return await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: { retention }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Retention Updated",
        description: "Report retention period has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update retention period",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Data Retention
        </CardTitle>
        <CardDescription>
          Configure how long report data should be kept before automatic cleanup
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="retention-select">Retention Period</Label>
          <Select
            value={currentRetention}
            onValueChange={(value) => updateRetentionMutation.mutate(value)}
            disabled={updateRetentionMutation.isPending}
          >
            <SelectTrigger id="retention-select" data-testid="select-retention">
              <SelectValue placeholder="Select retention period" />
            </SelectTrigger>
            <SelectContent>
              {RETENTION_OPTIONS.map((option) => (
                <SelectItem 
                  key={option.value} 
                  value={option.value}
                  data-testid={`option-retention-${option.value}`}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Report data older than the selected period will be automatically deleted by the system cleanup process.
          </p>
        </div>

        <div className="p-4 border rounded-lg bg-muted/30">
          <h4 className="font-medium text-sm mb-2">Retention Policies</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li><strong>1 Day:</strong> For temporary or test reports</li>
            <li><strong>7 Days:</strong> For short-term operational reports</li>
            <li><strong>30 Days:</strong> For standard monthly reporting (default)</li>
            <li><strong>1 Year:</strong> For compliance and historical analysis</li>
            <li><strong>Always:</strong> Data is never automatically deleted</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
