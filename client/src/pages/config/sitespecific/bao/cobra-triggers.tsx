import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  BaoCobraTriggerConfig,
  BaoCobraTriggerConfigRow,
} from "@shared/schema/sitespecific/bao/cobra-triggers";

interface QualifyingEventOption {
  id: string;
  name: string;
}

const NONE = "__none__";

interface RowState {
  trigger: boolean;
  qualifyingEventId: string | null;
  self?: boolean;
  dependentRelationshipTypeIds?: string[];
}

export default function BaoCobraTriggersPage() {
  usePageTitle("COBRA Triggers");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ rows: BaoCobraTriggerConfigRow[] }>({
    queryKey: ["/api/sitespecific/bao/cobra/trigger-config"],
  });

  const { data: qualifyingEvents } = useQuery<QualifyingEventOption[]>({
    queryKey: ["/api/options/bao-cobra-qualifying-event"],
  });
  const { data: relationshipTypes } = useQuery<QualifyingEventOption[]>({
    queryKey: ["/api/options/worker-relation-type"],
  });

  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data || dirty) return;
    const next: Record<string, RowState> = {};
    for (const row of data.rows) {
      next[row.pluginId] = {
        trigger: row.trigger,
        qualifyingEventId: row.qualifyingEventId,
        self: row.self,
        dependentRelationshipTypeIds: row.dependentRelationshipTypeIds,
      };
    }
    setRowState(next);
    setDirty(false);
  }, [data, dirty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const config: BaoCobraTriggerConfig = { plugins: {} };
      for (const [pluginId, state] of Object.entries(rowState)) {
        config.plugins[pluginId] = {
          trigger: state.trigger,
          qualifyingEventId: state.qualifyingEventId,
          ...(state.self !== undefined || state.dependentRelationshipTypeIds !== undefined
            ? { self: state.self ?? false, dependentRelationshipTypeIds: state.dependentRelationshipTypeIds ?? [] }
            : {}),
        };
      }
      return apiRequest("PUT", "/api/sitespecific/bao/cobra/trigger-config", config);
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({
        queryKey: ["/api/sitespecific/bao/cobra/trigger-config"],
      });
      toast({ title: "COBRA trigger configuration saved" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const setRow = (pluginId: string, patch: Partial<RowState>) => {
    setRowState((prev) => ({
      ...prev,
      [pluginId]: { ...prev[pluginId], ...patch },
    }));
    setDirty(true);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>COBRA Triggers</CardTitle>
              <CardDescription>
                Choose which eligibility failure reasons open a COBRA case when a
                medical or dental benefit ends. Failure-to-pay reasons are excluded
                by default. Optionally map each reason to a qualifying event stamped
                 on auto-created cases. Leave a rule unrestricted to include all
                 elected covered people, or choose exactly which relationships qualify.
              </CardDescription>
            </div>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
              data-testid="button-save-cobra-triggers"
            >
              {saveMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Eligibility rule</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="min-w-64">Covered relationships</TableHead>
                  <TableHead className="w-40">Triggers COBRA</TableHead>
                  <TableHead className="w-64">Qualifying event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.rows ?? []).map((row) => {
                  const state = rowState[row.pluginId] ?? {
                    trigger: row.trigger,
                    qualifyingEventId: row.qualifyingEventId,
                     self: row.self,
                     dependentRelationshipTypeIds: row.dependentRelationshipTypeIds,
                  };
                  return (
                    <TableRow key={row.pluginId} data-testid={`row-cobra-trigger-${row.pluginId}`}>
                      <TableCell className="font-medium" data-testid={`text-plugin-name-${row.pluginId}`}>
                        {row.pluginName}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {row.pluginDescription}
                      </TableCell>
                       <TableCell>
                         <div className="space-y-2">
                           <Select
                             value={state.self === undefined && state.dependentRelationshipTypeIds === undefined ? "all" : "selected"}
                             onValueChange={(value) => setRow(row.pluginId, value === "all"
                               ? { self: undefined, dependentRelationshipTypeIds: undefined }
                               : { self: true, dependentRelationshipTypeIds: [] })}
                             disabled={!state.trigger}
                           >
                             <SelectTrigger aria-label={`Relationship scope for ${row.pluginName}`} data-testid={`select-scope-${row.pluginId}`}>
                               <SelectValue />
                             </SelectTrigger>
                             <SelectContent>
                               <SelectItem value="all">All elected covered people (unrestricted)</SelectItem>
                               <SelectItem value="selected">Selected relationships only</SelectItem>
                             </SelectContent>
                           </Select>
                           {(state.self !== undefined || state.dependentRelationshipTypeIds !== undefined) && (
                             <div className="space-y-1" aria-label={`Selected relationships for ${row.pluginName}`}>
                               <label className="flex items-center gap-2 text-sm">
                                 <Checkbox
                                   checked={state.self === true}
                                   onCheckedChange={(checked) => setRow(row.pluginId, { self: checked === true })}
                                   disabled={!state.trigger}
                                   data-testid={`checkbox-self-${row.pluginId}`}
                                 />
                                 Subscriber (self)
                               </label>
                               {(relationshipTypes ?? []).map((type) => (
                                 <label key={type.id} className="flex items-center gap-2 text-sm">
                                   <Checkbox
                                     checked={(state.dependentRelationshipTypeIds ?? []).includes(type.id)}
                                     onCheckedChange={(checked) => setRow(row.pluginId, {
                                       dependentRelationshipTypeIds: checked === true
                                         ? [...(state.dependentRelationshipTypeIds ?? []), type.id]
                                         : (state.dependentRelationshipTypeIds ?? []).filter((id) => id !== type.id),
                                     })}
                                     disabled={!state.trigger}
                                     data-testid={`checkbox-relation-${row.pluginId}-${type.id}`}
                                   />
                                   {type.name}
                                 </label>
                               ))}
                               {!relationshipTypes && <span className="text-xs text-muted-foreground">Loading relationship types…</span>}
                               {relationshipTypes?.length === 0 && <span className="text-xs text-muted-foreground">No dependent relationship types available.</span>}
                               {!state.self && !(state.dependentRelationshipTypeIds ?? []).length && (
                                 <p className="text-xs text-muted-foreground">No people selected; this rule will open no cases.</p>
                               )}
                             </div>
                           )}
                         </div>
                       </TableCell>
                      <TableCell>
                        <Switch
                          checked={state.trigger}
                          onCheckedChange={(checked) =>
                            setRow(row.pluginId, { trigger: checked })
                          }
                          data-testid={`switch-trigger-${row.pluginId}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={state.qualifyingEventId ?? NONE}
                          onValueChange={(value) =>
                            setRow(row.pluginId, {
                              qualifyingEventId: value === NONE ? null : value,
                            })
                          }
                          disabled={!state.trigger}
                        >
                          <SelectTrigger data-testid={`select-qualifying-event-${row.pluginId}`}>
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>None</SelectItem>
                            {(qualifyingEvents ?? []).map((event) => (
                              <SelectItem key={event.id} value={event.id}>
                                {event.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
