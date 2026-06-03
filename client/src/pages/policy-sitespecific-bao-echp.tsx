import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PolicyLayout } from "@/components/layouts/PolicyLayout";
import { Save, Plus, Trash2, Loader2 } from "lucide-react";
import {
  baoEchpConfigSchema,
  DEFAULT_BAO_ECHP_BREAKPOINTS,
  type BaoEchpConfig,
  type BaoEchpBreakpoint,
} from "@shared/schema/sitespecific/bao/schema";

interface BreakpointDraft {
  maxHoursWorked: string;
  price: string;
}

function toDraft(breakpoints: BaoEchpBreakpoint[]): BreakpointDraft[] {
  return breakpoints.map((b) => ({
    maxHoursWorked: String(b.maxHoursWorked),
    price: String(b.price),
  }));
}

function EchpPricingContent() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const configQueryKey = ["/api/sitespecific/bao/echp/policy", id, "config"];

  const { data: config, isLoading } = useQuery<BaoEchpConfig>({
    queryKey: configQueryKey,
  });

  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<BreakpointDraft[]>([]);

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setRows(
      config.breakpoints.length > 0
        ? toDraft(config.breakpoints)
        : toDraft(DEFAULT_BAO_ECHP_BREAKPOINTS),
    );
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async (payload: BaoEchpConfig) => {
      return apiRequest(
        "PUT",
        `/api/sitespecific/bao/echp/policy/${id}/config`,
        payload,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configQueryKey });
      toast({ title: "Saved", description: "ECHP pricing was updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save",
        description: error?.message || "Could not save ECHP pricing.",
        variant: "destructive",
      });
    },
  });

  const updateRow = (index: number, field: keyof BreakpointDraft, value: string) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const addRow = () => {
    setRows((prev) => [...prev, { maxHoursWorked: "", price: "" }]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const breakpoints: BaoEchpBreakpoint[] = rows.map((row) => ({
      maxHoursWorked: Number(row.maxHoursWorked),
      price: Number(row.price),
    }));

    const candidate = { enabled, breakpoints };
    const parsed = baoEchpConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      toast({
        title: "Invalid pricing",
        description:
          "Each breakpoint needs a positive hours value and a non-negative price.",
        variant: "destructive",
      });
      return;
    }

    saveMutation.mutate(parsed.data);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Event Center Hours Purchase (ECHP) Pricing</CardTitle>
          <CardDescription>
            Set the price a worker pays for each "hours worked" breakpoint. When
            disabled, workers on this policy cannot purchase hours online.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-md border border-border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="echp-enabled" className="text-base">
                Enable ECHP for this policy
              </Label>
              <p className="text-sm text-muted-foreground">
                Workers can only purchase hours when this is enabled and at least
                one breakpoint is configured.
              </p>
            </div>
            <Switch
              id="echp-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              data-testid="switch-echp-enabled"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">
                Pricing breakpoints
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                data-testid="button-add-breakpoint"
              >
                <Plus size={16} className="mr-2" />
                Add breakpoint
              </Button>
            </div>

            {rows.length === 0 ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-no-breakpoints"
              >
                No breakpoints configured. Add at least one to enable purchasing.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-3 px-1 text-xs font-medium text-muted-foreground">
                  <span>Hours worked under</span>
                  <span>Price ($)</span>
                  <span className="sr-only">Actions</span>
                </div>
                {rows.map((row, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center"
                    data-testid={`row-breakpoint-${index}`}
                  >
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={row.maxHoursWorked}
                      onChange={(e) =>
                        updateRow(index, "maxHoursWorked", e.target.value)
                      }
                      placeholder="e.g. 40"
                      data-testid={`input-max-hours-${index}`}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.price}
                      onChange={(e) => updateRow(index, "price", e.target.value)}
                      placeholder="e.g. 750"
                      data-testid={`input-price-${index}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(index)}
                      data-testid={`button-remove-breakpoint-${index}`}
                    >
                      <Trash2 size={16} className="text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              A worker pays the price of the first breakpoint whose "hours worked
              under" value is greater than the hours they worked. If none match,
              the price is $0.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="button-save-echp-pricing"
            >
              {saveMutation.isPending ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <Save size={16} className="mr-2" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PolicyEchpPricingPage() {
  return (
    <PolicyLayout activeTab="sitespecific-bao-echp">
      <EchpPricingContent />
    </PolicyLayout>
  );
}
