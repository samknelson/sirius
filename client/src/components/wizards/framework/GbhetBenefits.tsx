import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  benefitConfigurationError,
  mappedBenefitFieldIds,
  type BenefitFieldConfig,
  type GbhetBenefitSetup,
} from "@shared/gbhet-legal-benefits";
import { ArrowRight, CheckCircle2, Gift, Info, RotateCcw, AlertCircle } from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

type Benefit = GbhetBenefitSetup["benefits"][number];

export function initialBenefitConfiguration(
  mappedIds: string[],
  savedConfig: BenefitFieldConfig[] | undefined,
  defaultBenefit: GbhetBenefitSetup["defaultBenefit"],
  activeIds: ReadonlySet<string>,
): BenefitFieldConfig[] {
  const saved = Array.isArray(savedConfig) ? savedConfig : [];
  return mappedIds.flatMap((fieldId) => {
    const explicit = saved.find((entry) => entry.fieldId === fieldId);
    if (explicit) return [{ ...explicit }];
    if (defaultBenefit && activeIds.has(defaultBenefit.id)) {
      return [{
        fieldId,
        benefitId: defaultBenefit.id,
        benefitName: defaultBenefit.name,
      }];
    }
    return [];
  });
}

export function GbhetBenefits({
  wizardId,
  step,
  data,
}: WizardStepComponentProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const stepDataKey = ["/api/wizards", wizardId, "dispatch", step.id, "data"];
  const { data: setup, isLoading, isError, error, refetch } = useQuery<GbhetBenefitSetup>({
    queryKey: stepDataKey,
  });
  const [benefitConfig, setBenefitConfig] = useState<BenefitFieldConfig[]>(
    Array.isArray(data?.benefitConfig) ? data.benefitConfig : [],
  );
  const initializedFor = useRef<string | null>(null);

  const columnMapping = data?.columnMapping || {};
  const mappedIds = useMemo(
    () => mappedBenefitFieldIds(setup?.fields ?? [], columnMapping),
    [setup?.fields, columnMapping],
  );
  const activeBenefits = useMemo(
    () => (setup?.benefits ?? []).filter((benefit) => benefit.isActive),
    [setup?.benefits],
  );
  const activeBenefitIds = useMemo(
    () => new Set(activeBenefits.map((benefit) => benefit.id)),
    [activeBenefits],
  );

  useEffect(() => {
    if (!setup) return;
    const key = `${wizardId}:${step.id}`;
    if (initializedFor.current === key) return;
    initializedFor.current = key;
    setBenefitConfig(initialBenefitConfiguration(
      mappedIds,
      data?.benefitConfig,
      setup.defaultBenefit,
      activeBenefitIds,
    ));
  }, [setup, wizardId, step.id, mappedIds, data?.benefitConfig, activeBenefitIds]);

  const launchArguments = data?.launchArguments || {};
  const uploadYear = launchArguments.year;
  const uploadMonth = launchArguments.month;
  const targetMonth = useMemo(() => {
    if (!uploadYear || !uploadMonth) return null;
    let month = uploadMonth + 3;
    let year = uploadYear;
    if (month > 12) {
      month -= 12;
      year += 1;
    }
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    return { display: `${monthNames[month - 1]} ${year}` };
  }, [uploadYear, uploadMonth]);

  const configurationError = benefitConfigurationError(
    mappedIds,
    benefitConfig,
    activeBenefitIds,
  );
  const saveConfig = benefitConfig.filter((entry) => mappedIds.includes(entry.fieldId));

  const saveMutation = useMutation({
    mutationFn: async () => apiRequest(
      "POST",
      `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
      { input: { benefitConfig: saveConfig } },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      queryClient.invalidateQueries({ queryKey: stepDataKey });
      toast({ title: "Success", description: "Benefit configuration saved" });
    },
    onError: (saveError: Error) => {
      toast({
        title: "Error",
        description: saveError.message || "Failed to save benefit configuration",
        variant: "destructive",
      });
    },
  });

  const changeBenefit = (fieldId: string, benefitId: string) => {
    const benefit = activeBenefits.find((item) => item.id === benefitId);
    setBenefitConfig((current) => {
      const remaining = current.filter((entry) => entry.fieldId !== fieldId);
      if (benefitId === "_none") return remaining;
      return [...remaining, { fieldId, benefitId, benefitName: benefit?.name }];
    });
  };
  const getBenefitForField = (fieldId: string) =>
    benefitConfig.find((entry) => entry.fieldId === fieldId)?.benefitId || "_none";

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gift className="h-5 w-5" />Configure Benefits</CardTitle>
          <CardDescription>Loading the benefit options for this upload…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gift className="h-5 w-5" />Configure Benefits</CardTitle>
          <CardDescription>Benefit eligibility is checked for this upload only.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Could not load benefit setup</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error instanceof Error ? error.message : "The benefit setup request failed."}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                <RotateCcw className="mr-2 h-4 w-4" />Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!setup) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Benefit setup is not available yet. Retry the request to continue.
        </CardContent>
      </Card>
    );
  }

  if (setup.fields.length === 0 || mappedIds.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gift className="h-5 w-5" />Configure Benefits</CardTitle>
          <CardDescription>Associate each mapped eligibility field with an active trust benefit.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>{setup.fields.length === 0 ? "Benefit fields unavailable" : "No benefit eligibility fields mapped"}</AlertTitle>
            <AlertDescription>
              {setup.fields.length === 0
                ? "This upload has no available benefit fields. Map an eligibility field in the mapping step before continuing."
                : "Map at least one uploaded column to a Benefit Eligibility field in the mapping step before continuing."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const mappedFields = setup.fields.filter((field) => mappedIds.includes(field.id));
  const invalidSavedConfigs = benefitConfig.filter(
    (entry) => mappedIds.includes(entry.fieldId) && !activeBenefitIds.has(entry.benefitId),
  );
  const visibleConfigurationError = configurationError
    ? setup.configurationError || configurationError
    : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Gift className="h-5 w-5" />Configure Benefits</CardTitle>
        <CardDescription>Choose the active trust benefit represented by each mapped eligibility column.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {targetMonth && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Benefit effective date</AlertTitle>
            <AlertDescription>
              Worker Monthly Benefit (WMB) records will be created for <strong>{targetMonth.display}</strong> (3 months after the upload month).
            </AlertDescription>
          </Alert>
        )}

        {setup.defaultBenefit ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm" data-testid="benefit-default">
            <span className="text-muted-foreground">Upload default</span>
            <span className="font-medium">{setup.defaultBenefit.name}</span>
            <Badge variant="secondary">Applied to unconfigured fields</Badge>
          </div>
        ) : (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Choose benefits explicitly</AlertTitle>
            <AlertDescription>
              {setup.defaultBenefitWarning
                ? `${setup.defaultBenefitWarning} Choose an active trust benefit for every mapped field.`
                : "No upload default is available. Choose an active trust benefit for every mapped field."}
            </AlertDescription>
          </Alert>
        )}

        {setup.defaultBenefitWarning && setup.defaultBenefit && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>{setup.defaultBenefitWarning}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Mapped benefit eligibility fields</h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Eligibility field</TableHead>
                  <TableHead className="w-10"><ArrowRight className="h-4 w-4" /></TableHead>
                  <TableHead>Trust benefit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappedFields.map((field) => {
                  const currentId = getBenefitForField(field.id);
                  const saved = benefitConfig.find((entry) => entry.fieldId === field.id);
                  const stale = !!saved && !activeBenefitIds.has(saved.benefitId);
                  return (
                    <TableRow key={field.id}>
                      <TableCell>
                        <div className="font-medium">{field.name}</div>
                        {field.description && <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>}
                      </TableCell>
                      <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                      <TableCell className="min-w-[260px]">
                        <Select value={currentId} onValueChange={(value) => changeBenefit(field.id, value)}>
                          <SelectTrigger aria-label={`Trust benefit for ${field.name}`} className={stale ? "border-destructive" : undefined}>
                            <SelectValue placeholder="Choose an active benefit…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">— Choose a benefit —</SelectItem>
                            {stale && saved?.benefitId && saved.benefitId !== "_none" && (
                              <SelectItem value={saved.benefitId}>
                                {saved.benefitName || saved.benefitId} (inactive or unavailable)
                              </SelectItem>
                            )}
                            {activeBenefits.map((benefit: Benefit) => (
                              <SelectItem key={benefit.id} value={benefit.id}>
                                <span>{benefit.name}</span>
                                {benefit.benefitTypeName && <span className="ml-2 text-xs text-muted-foreground">{benefit.benefitTypeName}</span>}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {stale && <p className="mt-1 text-xs text-destructive">This saved benefit is inactive or unavailable. Select a current benefit or clear it.</p>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {visibleConfigurationError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Benefit mapping needs attention</AlertTitle>
            <AlertDescription>
              {invalidSavedConfigs.length > 0
                ? "One or more saved benefits are no longer active. Replace or clear them, then choose an active benefit for every mapped field."
                : visibleConfigurationError}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Benefit mapping complete</AlertTitle>
            <AlertDescription>All {mappedFields.length} mapped field(s) have an active trust benefit association.</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !!visibleConfigurationError || mappedIds.length === 0}
            data-testid="button-save-benefits"
          >
            {saveMutation.isPending ? "Saving…" : "Save Configuration"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
