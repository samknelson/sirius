import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PolicyLayout, usePolicyLayout } from "@/components/layouts/PolicyLayout";
import { TrustBenefit } from "@shared/schema";
import { Save, Loader2, ExternalLink } from "lucide-react";

interface PolicyData {
  benefitIds?: string[];
}

const ELIGIBILITY_ADMIN_PATH = "/admin/plugin-configs/trust-eligibility";

function PolicyBenefitsContent() {
  const { policy } = usePolicyLayout();
  const { toast } = useToast();

  const policyData = (policy.data as PolicyData) || {};
  const [selectedBenefits, setSelectedBenefits] = useState<Set<string>>(
    new Set(policyData.benefitIds || [])
  );

  useEffect(() => {
    const currentData = (policy.data as PolicyData) || {};
    setSelectedBenefits(new Set(currentData.benefitIds || []));
  }, [policy.data]);

  const { data: benefits, isLoading: benefitsLoading } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      // Persist benefit membership on the policy and retire any leftover
      // legacy `eligibilityRules` blob. Eligibility rules themselves are now
      // managed centrally on the admin eligibility configuration page.
      const currentData = { ...((policy.data as Record<string, unknown>) || {}) };
      delete currentData.eligibilityRules;
      currentData.benefitIds = Array.from(selectedBenefits);
      await apiRequest("PUT", `/api/policies/${policy.id}`, { data: currentData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", policy.id] });
      toast({
        title: "Benefits Updated",
        description: "Policy benefits have been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update policy benefits.",
        variant: "destructive",
      });
    },
  });

  const handleBenefitToggle = (benefitId: string, checked: boolean) => {
    setSelectedBenefits((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(benefitId);
      } else {
        next.delete(benefitId);
      }
      return next;
    });
  };

  const activeBenefits = benefits?.filter((b) => b.isActive) || [];

  if (benefitsLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Trust Benefits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center space-x-3">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Trust Benefits</CardTitle>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            data-testid="button-save-benefits"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </CardHeader>
        <CardContent>
          {activeBenefits.length === 0 ? (
            <p className="text-muted-foreground" data-testid="text-no-benefits">
              No active trust benefits found. Create trust benefits in the configuration section first.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select the trust benefits that this policy offers:
              </p>
              <div className="grid gap-3">
                {activeBenefits.map((benefit) => (
                  <div
                    key={benefit.id}
                    className="flex items-start space-x-3 p-3 rounded-md border border-border"
                    data-testid={`benefit-row-${benefit.id}`}
                  >
                    <Checkbox
                      id={`benefit-${benefit.id}`}
                      checked={selectedBenefits.has(benefit.id)}
                      onCheckedChange={(checked) =>
                        handleBenefitToggle(benefit.id, checked === true)
                      }
                      data-testid={`checkbox-benefit-${benefit.id}`}
                    />
                    <label
                      htmlFor={`benefit-${benefit.id}`}
                      className="text-sm font-medium cursor-pointer flex-1"
                    >
                      {benefit.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eligibility Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Eligibility rules are managed centrally on the eligibility configuration
            page, where each rule can be scoped to a policy and benefit. Use that page
            to add, edit, or remove the rules that decide which workers qualify for a
            benefit.
          </p>
          <Link href={ELIGIBILITY_ADMIN_PATH}>
            <Button variant="outline" data-testid="link-eligibility-config">
              <ExternalLink className="h-4 w-4 mr-2" />
              Manage eligibility rules
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PolicyBenefits() {
  return (
    <PolicyLayout activeTab="benefits">
      <PolicyBenefitsContent />
    </PolicyLayout>
  );
}
