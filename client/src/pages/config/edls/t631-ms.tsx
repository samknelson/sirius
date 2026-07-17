import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Loader2, Save, ListChecks } from "lucide-react";
import { Variable } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const VARIABLE_NAME = "sitespecific.t631.ms_to_sync";

interface MemberStatus {
  id: string;
  name: string;
  sequence?: number;
}

function parseSelection(variable: Variable | null | undefined): string[] {
  const value = variable?.value;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export default function T631MemberStatusSyncPage() {
  usePageTitle("Teamsters 631 MS");
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: statuses = [], isLoading: statusesLoading } = useQuery<MemberStatus[]>({
    queryKey: ["/api/options/worker-ms"],
  });

  const { data: variable, isLoading: variableLoading } = useQuery<Variable | null>({
    queryKey: ["/api/variables/by-name", VARIABLE_NAME],
    queryFn: async () => {
      const response = await fetch(`/api/variables/by-name/${VARIABLE_NAME}`, {
        credentials: "include",
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Failed to load saved selection");
      return response.json();
    },
  });

  const savedSelection = useMemo(() => parseSelection(variable), [variable]);

  useEffect(() => {
    setSelected(new Set(savedSelection));
  }, [savedSelection]);

  const sorted = useMemo(
    () =>
      [...statuses].sort(
        (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.name.localeCompare(b.name),
      ),
    [statuses],
  );

  const saveMutation = useMutation({
    mutationFn: async (ids: string[]) =>
      apiRequest("PUT", `/api/variables/by-name/${VARIABLE_NAME}`, { value: ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/variables/by-name", VARIABLE_NAME] });
      toast({
        title: "Saved",
        description: "Member statuses to sync have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save selection.",
        variant: "destructive",
      });
    },
  });

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const hasChanges = useMemo(() => {
    if (selected.size !== savedSelection.length) return true;
    return savedSelection.some((id) => !selected.has(id));
  }, [selected, savedSelection]);

  if (statusesLoading || variableLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="heading-t631-ms">
          Teamsters 631 MS
        </h1>
        <p className="text-muted-foreground mt-2">
          Choose which member statuses are synced from the Teamsters 631 server
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Member Statuses to Sync
          </CardTitle>
          <CardDescription>
            Only checked member statuses will be synced. When nothing is checked, nothing syncs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-member-statuses">
              No member statuses are defined. Add them under Dropdown Lists &gt; Worker Member
              Statuses.
            </p>
          ) : (
            <div className="space-y-3">
              {sorted.map((status) => (
                <div key={status.id} className="flex items-center gap-3">
                  <Checkbox
                    id={`ms-${status.id}`}
                    checked={selected.has(status.id)}
                    onCheckedChange={(checked) => toggle(status.id, checked === true)}
                    data-testid={`checkbox-ms-${status.id}`}
                  />
                  <Label htmlFor={`ms-${status.id}`} className="font-normal cursor-pointer">
                    {status.name}
                  </Label>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate(Array.from(selected))}
              disabled={!hasChanges || saveMutation.isPending}
              data-testid="button-save-t631-ms"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
