import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Users, Undo2, UserMinus } from "lucide-react";
import { DependentsStep } from "@/components/wizards/framework/enrollment/DependentsStep";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface CurrentRelationship {
  relationId: string;
  label: string;
}

/**
 * Life Event dependents step. The event chosen in step 1 decides the mode:
 *   - add (birth / marriage) → reuse the shared add-a-dependent flow.
 *   - remove (divorce / death) → pick one of the current dependents to drop
 *     from the election (the relationship record itself is left untouched;
 *     it simply won't carry forward).
 */
export function LifeEventDependentsStep(props: WizardStepComponentProps) {
  const { wizardId, step, data } = props;
  const { toast } = useToast();
  const eventAction = data?.eventAction as "add" | "remove" | undefined;

  const submitUrl = `/api/wizards/${wizardId}/dispatch/${step.id}/submit`;
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
  const onError = (error: Error) =>
    toast({ title: "Error", description: error.message, variant: "destructive" });

  const markMutation = useMutation({
    mutationFn: async (vars: { action: string; relationId: string }) =>
      apiRequest("POST", submitUrl, { input: vars }),
    onSuccess: invalidate,
    onError,
  });

  if (!eventAction) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Choose a life event first.
        </CardContent>
      </Card>
    );
  }

  // Add mode reuses the shared step verbatim.
  if (eventAction === "add") {
    return <DependentsStep {...props} />;
  }

  const current: CurrentRelationship[] = Array.isArray(data?.currentRelationships)
    ? (data.currentRelationships as CurrentRelationship[])
    : [];
  const removed: string[] = Array.isArray(data?.removedRelationshipIds)
    ? (data.removedRelationshipIds as string[])
    : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Users className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Remove a Dependent</CardTitle>
            <CardDescription>
              Select the dependent to remove from this worker's election. The
              new election will carry every other dependent forward.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {current.length === 0 ? (
          <div
            className="text-center py-6 text-muted-foreground"
            data-testid="text-no-current-dependents"
          >
            This election has no dependents to remove.
          </div>
        ) : (
          current.map((rel) => {
            const isRemoved = removed.includes(rel.relationId);
            return (
              <div
                key={rel.relationId}
                className="flex items-center gap-3 rounded-lg border p-3"
                data-testid={`row-current-dependent-${rel.relationId}`}
              >
                <div className="flex-1">
                  <span
                    className={isRemoved ? "line-through text-muted-foreground" : "font-medium"}
                  >
                    {rel.label}
                  </span>
                  {isRemoved && (
                    <Badge variant="destructive" className="ml-2">
                      Will be removed
                    </Badge>
                  )}
                </div>
                {isRemoved ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      markMutation.mutate({
                        action: "restoreCurrent",
                        relationId: rel.relationId,
                      })
                    }
                    disabled={markMutation.isPending}
                    data-testid={`button-restore-dependent-${rel.relationId}`}
                  >
                    <Undo2 size={16} className="mr-2" />
                    Keep
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      markMutation.mutate({
                        action: "removeCurrent",
                        relationId: rel.relationId,
                      })
                    }
                    disabled={markMutation.isPending}
                    data-testid={`button-remove-dependent-${rel.relationId}`}
                  >
                    <UserMinus size={16} className="mr-2" />
                    Remove
                  </Button>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
