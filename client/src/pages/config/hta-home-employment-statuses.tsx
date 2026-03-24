import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { Save, Briefcase } from "lucide-react";

interface EmploymentStatus {
  id: string;
  name: string;
  code: string;
  employed: boolean;
  description: string | null;
  sequence: number;
}

interface Variable {
  id: string;
  name: string;
  value: string[];
}

const VARIABLE_NAME = "sitespecific_hta_home_employment_statuses";

export default function HtaHomeEmploymentStatusesPage() {
  usePageTitle("Home Employment Statuses");
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: statuses, isLoading: statusesLoading } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/options/employment-status"],
  });

  const { data: variable, isLoading: variableLoading } = useQuery<Variable | null>({
    queryKey: ["/api/variables/by-name", VARIABLE_NAME],
    queryFn: async () => {
      try {
        return await apiRequest("GET", `/api/variables/by-name/${VARIABLE_NAME}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });

  useEffect(() => {
    if (variable?.value && Array.isArray(variable.value)) {
      setSelectedIds(variable.value);
    }
  }, [variable]);

  const saveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (variable?.id) {
        return apiRequest("PUT", `/api/variables/${variable.id}`, {
          name: VARIABLE_NAME,
          value: ids,
        });
      } else {
        return apiRequest("POST", "/api/variables", {
          name: VARIABLE_NAME,
          value: ids,
        });
      }
    },
    onSuccess: () => {
      toast({
        title: "Settings saved",
        description: "Home employment statuses have been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/variables/by-name", VARIABLE_NAME] });
      apiRequest("POST", "/api/admin/dispatch-elig-plugins/dispatch_hta_home_employer/backfill").catch(() => {});
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleToggle = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    saveMutation.mutate(selectedIds);
  };

  const isLoading = statusesLoading || variableLoading;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const sortedStatuses = [...(statuses || [])].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">
          Home Employment Statuses
        </h1>
        <p className="text-muted-foreground">
          Select which employment statuses are considered &quot;home employment&quot; for the HTA Home Employer dispatch eligibility plugin.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Employment Statuses
          </CardTitle>
          <CardDescription>
            Workers with a checked employment status at an employer will be excluded from dispatch to that employer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedStatuses.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-statuses">
              No employment statuses have been configured yet.
            </p>
          ) : (
            sortedStatuses.map(status => (
              <div
                key={status.id}
                className="flex items-center space-x-3 rounded-lg border p-3"
                data-testid={`row-status-${status.id}`}
              >
                <Checkbox
                  id={`status-${status.id}`}
                  checked={selectedIds.includes(status.id)}
                  onCheckedChange={() => handleToggle(status.id)}
                  data-testid={`checkbox-status-${status.id}`}
                />
                <Label
                  htmlFor={`status-${status.id}`}
                  className="flex-1 cursor-pointer"
                >
                  <span className="font-medium">{status.name}</span>
                  {status.code && (
                    <span className="ml-2 text-xs text-muted-foreground">({status.code})</span>
                  )}
                  {status.description && (
                    <span className="block text-sm text-muted-foreground">{status.description}</span>
                  )}
                </Label>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          data-testid="button-save"
        >
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
