import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Info, Calendar } from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface GbhetLegalComplianceInputsStepProps {
  wizardId: string;
  wizardType: string;
  data?: {
    config?: {
      workMonthFrom?: string;
      workMonthTo?: string;
    };
  };
  onDataChange?: (data: any) => void;
}

export function GbhetLegalComplianceInputsStep({ 
  wizardId, 
  wizardType, 
  data,
  onDataChange 
}: GbhetLegalComplianceInputsStepProps) {
  const config = data?.config || {};
  
  const [workMonthFrom, setWorkMonthFrom] = useState(config.workMonthFrom || "");
  const [workMonthTo, setWorkMonthTo] = useState(config.workMonthTo || "");

  const saveConfigMutation = useMutation({
    mutationFn: async (newConfig: any) => {
      return await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: {
          ...(data || {}),
          config: newConfig,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards", wizardId] });
    },
  });

  useEffect(() => {
    const newConfig = {
      workMonthFrom: workMonthFrom || undefined,
      workMonthTo: workMonthTo || undefined,
    };

    const timer = setTimeout(() => {
      saveConfigMutation.mutate(newConfig);
    }, 500);

    return () => clearTimeout(timer);
  }, [workMonthFrom, workMonthTo]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>GBHET Legal Compliance Check Configuration</CardTitle>
        <CardDescription>
          Configure the date range for the compliance check
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-md">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Report Description
            </p>
            <p className="text-sm text-blue-800 dark:text-blue-200">
              This report identifies workers who had 80+ hours in a work month but are missing 
              the required legal benefit after the 3-month lag period. For example, January work 
              should result in an April benefit.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <Label className="text-base font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Work Month Range (Optional)
          </Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="workMonthFrom" className="text-sm">From Work Month</Label>
              <Input
                id="workMonthFrom"
                type="month"
                value={workMonthFrom}
                onChange={(e) => setWorkMonthFrom(e.target.value)}
                data-testid="input-work-month-from"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workMonthTo" className="text-sm">To Work Month</Label>
              <Input
                id="workMonthTo"
                type="month"
                value={workMonthTo}
                onChange={(e) => setWorkMonthTo(e.target.value)}
                data-testid="input-work-month-to"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Filter by work month (the month when hours were worked). Leave blank to include all work months.
            The report will check if benefits exist for the corresponding benefit month (3 months after work month).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
