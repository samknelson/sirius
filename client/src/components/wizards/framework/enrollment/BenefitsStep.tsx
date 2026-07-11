import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { HeartPulse, CheckCircle2, XCircle } from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface EligibleBenefitRow {
  benefitId: string;
  benefitName: string;
  benefitTypeId: string | null;
  benefitTypeName: string | null;
  benefitTypeSequence: number | null;
  benefitTypeOnlyOne: boolean;
  eligible: boolean;
  reasons: Array<{ pluginName: string; eligible: boolean; reason?: string }>;
}

interface BenefitTypeGroup {
  typeId: string;
  typeName: string;
  onlyOne: boolean;
  sequence: number | null;
  rows: EligibleBenefitRow[];
}

const UNGROUPED_ID = "__ungrouped__";

/**
 * Group the eligible benefits under their benefit type. Groups are ordered by
 * the type's configured sequence (then name); benefits with no type fall into
 * a trailing "Other" group. This is display-only — the server re-validates the
 * selection on submit.
 */
function groupByType(rows: EligibleBenefitRow[]): BenefitTypeGroup[] {
  const groups = new Map<string, BenefitTypeGroup>();
  for (const row of rows) {
    const typeId = row.benefitTypeId ?? UNGROUPED_ID;
    let group = groups.get(typeId);
    if (!group) {
      group = {
        typeId,
        typeName: row.benefitTypeName ?? "Other",
        onlyOne: typeId === UNGROUPED_ID ? false : row.benefitTypeOnlyOne,
        sequence: typeId === UNGROUPED_ID ? null : row.benefitTypeSequence,
        rows: [],
      };
      groups.set(typeId, group);
    }
    group.rows.push(row);
  }
  const list = Array.from(groups.values());
  list.sort((a, b) => {
    if (a.typeId === UNGROUPED_ID) return 1;
    if (b.typeId === UNGROUPED_ID) return -1;
    const sa = a.sequence ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sequence ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.typeName.localeCompare(b.typeName);
  });
  for (const group of list) {
    group.rows.sort((a, b) => a.benefitName.localeCompare(b.benefitName));
  }
  return list;
}

/**
 * Step 2: pick benefits. Eligibility comes from the server-side "start"
 * scan; ineligible benefits are shown greyed-out with their reasons and
 * cannot be selected (the server re-validates on submit anyway).
 */
export function BenefitsStep({ wizardId, step, data }: WizardStepComponentProps) {
  const { toast } = useToast();
  const savedIds: string[] = Array.isArray(data?.benefitIds)
    ? (data.benefitIds as string[])
    : [];
  const [selected, setSelected] = useState<string[]>(savedIds);
  useEffect(() => {
    setSelected(savedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(savedIds)]);

  const { data: stepData, isLoading } = useQuery<{
    records: EligibleBenefitRow[];
    ineligibleCount?: number;
    message?: string;
  }>({
    queryKey: [`/api/wizards/${wizardId}/dispatch/${step.id}/data`],
    enabled: !!data?.policyId,
  });

  // The server only offers eligible benefits; ineligible ones are never shown.
  const rows = stepData?.records ?? [];
  const groups = groupByType(rows);
  const ineligibleCount = stepData?.ineligibleCount ?? 0;

  const saveMutation = useMutation({
    mutationFn: async (benefitIds: string[]) =>
      apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
        { input: { benefitIds } },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({ title: "Benefits saved" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!data?.policyId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-benefits-need-policy">
          Choose an employer and policy first.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <HeartPulse className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Benefits</CardTitle>
            <CardDescription>
              Select the benefits to enroll in. Only benefits the worker is
              currently eligible for can be selected.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-benefits">
            {ineligibleCount > 0
              ? "The worker is not currently eligible for any benefits under this policy."
              : "The selected policy has no benefits configured."}
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div
                key={group.typeId}
                className="space-y-2"
                data-testid={`group-benefit-type-${group.typeId}`}
              >
                <div className="flex items-center gap-2">
                  <h3
                    className="text-sm font-semibold text-foreground"
                    data-testid={`heading-benefit-type-${group.typeId}`}
                  >
                    {group.typeName}
                  </h3>
                  {group.onlyOne && (
                    <Badge variant="outline" data-testid={`badge-choose-one-${group.typeId}`}>
                      Choose one
                    </Badge>
                  )}
                </div>
                {group.rows.map((row) => (
                  <div
                    key={row.benefitId}
                    className="flex items-start gap-3 rounded-lg border p-4"
                    data-testid={`row-benefit-${row.benefitId}`}
                  >
                    <Checkbox
                      id={`benefit-${row.benefitId}`}
                      checked={selected.includes(row.benefitId)}
                      disabled={saveMutation.isPending}
                      onCheckedChange={(checked) => {
                        setSelected((prev) => {
                          if (!checked) {
                            return prev.filter((id) => id !== row.benefitId);
                          }
                          if (group.onlyOne) {
                            // Single-select type: picking one benefit replaces
                            // any other already-picked benefit of the same type.
                            const sameTypeIds = new Set(
                              group.rows.map((r) => r.benefitId),
                            );
                            return [
                              ...prev.filter((id) => !sameTypeIds.has(id)),
                              row.benefitId,
                            ];
                          }
                          return [...prev, row.benefitId];
                        });
                      }}
                      className="mt-0.5"
                      data-testid={`checkbox-benefit-${row.benefitId}`}
                    />
                    <Label
                      htmlFor={`benefit-${row.benefitId}`}
                      className="flex-1 space-y-1 cursor-pointer"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        {row.benefitName}
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 size={12} /> Eligible
                        </Badge>
                      </span>
                    </Label>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate(selected)}
              disabled={selected.length === 0 || saveMutation.isPending}
              data-testid="button-save-benefits"
            >
              {saveMutation.isPending ? "Saving…" : "Save Selection"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
