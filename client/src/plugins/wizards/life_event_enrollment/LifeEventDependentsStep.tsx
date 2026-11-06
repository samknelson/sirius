import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { DependentGenderFields } from "@/components/wizards/framework/enrollment/DependentGenderFields";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import { useNextSubmission } from "@/components/wizards/framework/NextSubmission";

interface GenderOption {
  id: string;
  nota: boolean;
}

interface CurrentRelationship {
  relationId: string;
  label: string;
  gender?: string | null;
  genderNota?: string | null;
  genderCalc?: string | null;
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
  const [addActivity, setAddActivity] = useState(false);
  const [genderDrafts, setGenderDrafts] = useState<
    Record<string, { gender: string; genderNota: string }>
  >({});
  const eventAction = data?.eventAction as "add" | "remove" | undefined;
  const stepDataKey = `/api/wizards/${wizardId}/dispatch/${step.id}/data`;
  const { data: stepData, isLoading: stepDataLoading, isError: stepDataError, isSuccess: stepDataLoaded } = useQuery<{
    currentRelationships?: CurrentRelationship[];
  }>({ queryKey: [stepDataKey] });
  const { data: genderOptions, isLoading: genderOptionsLoading, isError: genderOptionsError } = useQuery<GenderOption[]>({
    queryKey: ["/api/options/gender"],
  });

  const submitUrl = `/api/wizards/${wizardId}/dispatch/${step.id}/submit`;
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    queryClient.invalidateQueries({ queryKey: [stepDataKey] });
  };
  const onError = (error: Error) =>
    toast({ title: "Error", description: error.message, variant: "destructive" });

  const markMutation = useMutation({
    mutationFn: async (vars: {
      action: string;
      relationId: string;
      gender?: string;
      genderNota?: string;
    }) =>
      apiRequest("POST", submitUrl, { input: vars }),
    onSuccess: invalidate,
    onError,
  });

  const current: CurrentRelationship[] = Array.isArray(stepData?.currentRelationships)
    ? stepData.currentRelationships
    : Array.isArray(data?.currentRelationships)
      ? (data.currentRelationships as CurrentRelationship[])
      : [];
  const removed: string[] = Array.isArray(data?.removedRelationshipIds)
    ? (data.removedRelationshipIds as string[])
    : [];
  const dependents = Array.isArray(data?.dependents) ? data.dependents : [];
  const genderOptionsReady = !genderOptionsLoading && !genderOptionsError && Array.isArray(genderOptions);
  const pendingGenderEntries = Object.entries(genderDrafts);
  const pendingGendersValid = pendingGenderEntries.every(([, draft]) => {
    if (!draft.gender || !genderOptionsReady) return false;
    const option = genderOptions!.find(entry => entry.id === draft.gender);
    return !!option && (!option.nota || !!draft.genderNota.trim());
  });
  const ready = eventAction === "add"
    ? dependents.length > 0 && !addActivity
    : eventAction === "remove" &&
      stepDataLoaded && !stepDataError && removed.length > 0 &&
      (pendingGenderEntries.length === 0 || pendingGendersValid) &&
      !markMutation.isPending;
  const navigating = useNextSubmission({
    ready,
    busy: markMutation.isPending || addActivity,
    guidance: eventAction === "remove" && stepDataError
      ? "The current dependents could not load. Reload this step before continuing."
      : pendingGenderEntries.length > 0 && !pendingGendersValid
        ? genderOptionsError || genderOptionsLoading
          ? "Gender choices could not be verified. Reload this step before saving."
          : "Choose a valid gender for each edited dependent and complete any required specification."
        : eventAction === "add"
          ? "Add a dependent before continuing. Next saves the step and advances."
          : "Select a dependent to remove before continuing. Next saves pending gender edits and advances.",
    submit: async () => {
      if (!ready) throw new Error("Complete the dependent changes before continuing.");
      let savedGenderCount = 0;
      let finishingStep = false;
      try {
        for (const [relationId, draft] of pendingGenderEntries) {
          await apiRequest("POST", submitUrl, {
            input: {
              action: "setCurrentGender",
              relationId,
              gender: draft.gender,
              genderNota: draft.genderNota,
            },
          });
          savedGenderCount += 1;
          setGenderDrafts(previous => {
            if (previous[relationId] !== draft) return previous;
            const next = { ...previous };
            delete next[relationId];
            return next;
          });
        }
        finishingStep = true;
        await apiRequest("POST", submitUrl, { input: { action: "continue" } });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Request failed.";
        if (finishingStep) {
          throw new Error(pendingGenderEntries.length > 0
            ? `All ${savedGenderCount} gender changes were saved, but the step could not be completed. Try Next again. ${reason}`
            : `The step could not be saved for continuing. No gender changes were pending. Try Next again. ${reason}`);
        }
        if (savedGenderCount > 0) {
          throw new Error(
            `Saved ${savedGenderCount} of ${pendingGenderEntries.length} gender changes. Only unconfirmed edits remain; try Next again. ${reason}`,
          );
        }
        throw new Error(`No gender changes were confirmed as saved. Your edits remain available; try Next again. ${reason}`);
      } finally {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] }),
          queryClient.invalidateQueries({ queryKey: [stepDataKey] }),
        ]);
      }
    },
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
    return (
      <DependentsStep
        {...props}
        activityLocked={navigating}
        onActivityChange={setAddActivity}
      />
    );
  }

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
                new election will carry every other dependent forward. Gender
                edits update that dependent's worker contact when you select Next.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {stepDataLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading current dependents…</p>
        ) : stepDataError ? (
          <p className="text-sm text-destructive" role="alert">Current dependents could not load. Reload this step to try again.</p>
        ) : current.length === 0 ? (
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
                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
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
                <div className="flex-1">
                  <DependentGenderFields
                    idPrefix={`current-dependent-${rel.relationId}`}
                    gender={genderDrafts[rel.relationId]?.gender ?? ""}
                    genderNota={genderDrafts[rel.relationId]?.genderNota ?? ""}
                    disabled={navigating || markMutation.isPending || !genderOptionsReady}
                    currentDesignation={rel.genderCalc}
                    showUnspecifiedCurrent
                    onGenderChange={(gender) => setGenderDrafts(previous => {
                      if (!gender) {
                        const next = { ...previous };
                        delete next[rel.relationId];
                        return next;
                      }
                      return {
                        ...previous,
                        [rel.relationId]: {
                          gender,
                          genderNota: previous[rel.relationId]?.genderNota ?? "",
                        },
                      };
                    })}
                    onGenderNotaChange={(genderNota) => setGenderDrafts(previous => {
                      const gender = previous[rel.relationId]?.gender ?? "";
                      if (!gender && !genderNota) return previous;
                      return {
                        ...previous,
                        [rel.relationId]: { gender, genderNota },
                      };
                    })}
                  />
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
                    disabled={markMutation.isPending || navigating}
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
                    disabled={markMutation.isPending || navigating}
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
