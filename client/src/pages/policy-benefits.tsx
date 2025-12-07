import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PolicyLayout, usePolicyLayout } from "@/components/layouts/PolicyLayout";
import { TrustBenefit } from "@shared/schema";
import { Save, Loader2, ChevronDown, ChevronRight, Plus, Trash2, Settings } from "lucide-react";

interface EligibilityRule {
  pluginKey: string;
  appliesTo: ("start" | "continue")[];
  config: Record<string, unknown>;
}

interface PolicyData {
  benefitIds?: string[];
  eligibilityRules?: Record<string, EligibilityRule[]>;
}

interface EligibilityPlugin {
  id: string;
  name: string;
  description: string;
}

interface WorkerWs {
  id: string;
  name: string;
  description: string | null;
}

function EligibilityRuleEditor({
  rule,
  plugins,
  workStatuses,
  onUpdate,
  onRemove,
}: {
  rule: EligibilityRule;
  plugins: EligibilityPlugin[];
  workStatuses: WorkerWs[];
  onUpdate: (updatedRule: EligibilityRule) => void;
  onRemove: () => void;
}) {
  const plugin = plugins.find((p) => p.id === rule.pluginKey);

  const handleAppliesToChange = (scanType: "start" | "continue", checked: boolean) => {
    const newAppliesTo = checked
      ? [...rule.appliesTo, scanType]
      : rule.appliesTo.filter((t) => t !== scanType);
    onUpdate({ ...rule, appliesTo: newAppliesTo.length > 0 ? newAppliesTo : ["start"] });
  };

  const handleStatusToggle = (statusId: string, checked: boolean) => {
    const currentStatuses = (rule.config.allowedStatusIds as string[]) || [];
    const newStatuses = checked
      ? [...currentStatuses, statusId]
      : currentStatuses.filter((id) => id !== statusId);
    onUpdate({ ...rule, config: { ...rule.config, allowedStatusIds: newStatuses } });
  };

  const handleMonthsOffsetChange = (value: string) => {
    const months = parseInt(value, 10);
    if (!isNaN(months) && months >= 1) {
      onUpdate({ ...rule, config: { ...rule.config, monthsOffset: months } });
    }
  };

  return (
    <div className="border border-border rounded-md p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{plugin?.name || rule.pluginKey}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          data-testid={`button-remove-rule-${rule.pluginKey}`}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{plugin?.description}</p>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Applies to scan types:</Label>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`rule-start-${rule.pluginKey}`}
              checked={rule.appliesTo.includes("start")}
              onCheckedChange={(checked) => handleAppliesToChange("start", checked === true)}
            />
            <label htmlFor={`rule-start-${rule.pluginKey}`} className="text-sm">
              Start
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`rule-continue-${rule.pluginKey}`}
              checked={rule.appliesTo.includes("continue")}
              onCheckedChange={(checked) => handleAppliesToChange("continue", checked === true)}
            />
            <label htmlFor={`rule-continue-${rule.pluginKey}`} className="text-sm">
              Continue
            </label>
          </div>
        </div>
      </div>

      {rule.pluginKey === "work-status" && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Allowed work statuses:</Label>
          <div className="grid grid-cols-2 gap-2">
            {workStatuses.map((ws) => (
              <div key={ws.id} className="flex items-center gap-2">
                <Checkbox
                  id={`ws-${ws.id}`}
                  checked={((rule.config.allowedStatusIds as string[]) || []).includes(ws.id)}
                  onCheckedChange={(checked) => handleStatusToggle(ws.id, checked === true)}
                />
                <label htmlFor={`ws-${ws.id}`} className="text-sm">
                  {ws.name}
                </label>
              </div>
            ))}
          </div>
          {workStatuses.length === 0 && (
            <p className="text-sm text-muted-foreground">No work statuses configured.</p>
          )}
        </div>
      )}

      {rule.pluginKey === "gbhet-legal" && (
        <div className="space-y-2">
          <Label htmlFor="months-offset" className="text-sm font-medium">
            Months offset (how many months prior to check):
          </Label>
          <Input
            id="months-offset"
            type="number"
            min={1}
            value={(rule.config.monthsOffset as number) || 4}
            onChange={(e) => handleMonthsOffsetChange(e.target.value)}
            className="w-24"
          />
        </div>
      )}
    </div>
  );
}

function BenefitEligibilityConfig({
  benefit,
  rules,
  plugins,
  workStatuses,
  onUpdateRules,
}: {
  benefit: TrustBenefit;
  rules: EligibilityRule[];
  plugins: EligibilityPlugin[];
  workStatuses: WorkerWs[];
  onUpdateRules: (newRules: EligibilityRule[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<string>("");

  const handleAddRule = () => {
    if (!selectedPlugin) return;

    const defaultConfig: Record<string, unknown> = { appliesTo: ["start", "continue"] };
    if (selectedPlugin === "work-status") {
      defaultConfig.allowedStatusIds = [];
    } else if (selectedPlugin === "gbhet-legal") {
      defaultConfig.monthsOffset = 4;
    }

    const newRule: EligibilityRule = {
      pluginKey: selectedPlugin,
      appliesTo: ["start", "continue"],
      config: defaultConfig,
    };

    onUpdateRules([...rules, newRule]);
    setShowAddDialog(false);
    setSelectedPlugin("");
    setIsOpen(true);
  };

  const handleUpdateRule = (index: number, updatedRule: EligibilityRule) => {
    const newRules = [...rules];
    newRules[index] = updatedRule;
    onUpdateRules(newRules);
  };

  const handleRemoveRule = (index: number) => {
    const newRules = rules.filter((_, i) => i !== index);
    onUpdateRules(newRules);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border border-border rounded-md">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between p-4 h-auto"
            data-testid={`button-expand-benefit-${benefit.id}`}
          >
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="font-medium">{benefit.name}</span>
              {rules.length > 0 && (
                <Badge variant="secondary">{rules.length} rule{rules.length !== 1 ? "s" : ""}</Badge>
              )}
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            {benefit.description && (
              <p className="text-sm text-muted-foreground">{benefit.description}</p>
            )}

            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No eligibility rules configured. All workers are eligible by default.
              </p>
            ) : (
              <div className="space-y-3">
                {rules.map((rule, index) => (
                  <EligibilityRuleEditor
                    key={`${rule.pluginKey}-${index}`}
                    rule={rule}
                    plugins={plugins}
                    workStatuses={workStatuses}
                    onUpdate={(updatedRule) => handleUpdateRule(index, updatedRule)}
                    onRemove={() => handleRemoveRule(index)}
                  />
                ))}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddDialog(true)}
              data-testid={`button-add-rule-${benefit.id}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Eligibility Rule
            </Button>

            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Eligibility Rule</DialogTitle>
                  <DialogDescription>
                    Select an eligibility plugin to add to {benefit.name}.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Label htmlFor="plugin-select">Eligibility Plugin</Label>
                  <Select value={selectedPlugin} onValueChange={setSelectedPlugin}>
                    <SelectTrigger id="plugin-select" data-testid="select-plugin">
                      <SelectValue placeholder="Select a plugin..." />
                    </SelectTrigger>
                    <SelectContent>
                      {plugins.map((plugin) => (
                        <SelectItem key={plugin.id} value={plugin.id}>
                          {plugin.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedPlugin && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {plugins.find((p) => p.id === selectedPlugin)?.description}
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddRule} disabled={!selectedPlugin}>
                    Add Rule
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function PolicyBenefitsContent() {
  const { policy } = usePolicyLayout();
  const { toast } = useToast();

  const policyData = (policy.data as PolicyData) || {};
  const [selectedBenefits, setSelectedBenefits] = useState<Set<string>>(
    new Set(policyData.benefitIds || [])
  );
  const [eligibilityRules, setEligibilityRules] = useState<Record<string, EligibilityRule[]>>(
    policyData.eligibilityRules || {}
  );

  useEffect(() => {
    const currentData = (policy.data as PolicyData) || {};
    setSelectedBenefits(new Set(currentData.benefitIds || []));
    setEligibilityRules(currentData.eligibilityRules || {});
  }, [policy.data]);

  const { data: benefits, isLoading: benefitsLoading } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const { data: plugins = [] } = useQuery<EligibilityPlugin[]>({
    queryKey: ["/api/eligibility-plugins"],
  });

  const { data: workStatuses = [] } = useQuery<WorkerWs[]>({
    queryKey: ["/api/worker-work-statuses"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { benefitIds: string[]; eligibilityRules: Record<string, EligibilityRule[]> }) => {
      const currentData = (policy.data as Record<string, unknown>) || {};
      const newData = {
        ...currentData,
        benefitIds: data.benefitIds,
        eligibilityRules: data.eligibilityRules,
      };
      return apiRequest("PUT", `/api/policies/${policy.id}`, { data: newData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", policy.id] });
      toast({
        title: "Benefits Updated",
        description: "Policy benefits and eligibility rules have been saved successfully.",
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
        setEligibilityRules((prevRules) => {
          const newRules = { ...prevRules };
          delete newRules[benefitId];
          return newRules;
        });
      }
      return next;
    });
  };

  const handleUpdateRulesForBenefit = (benefitId: string, newRules: EligibilityRule[]) => {
    setEligibilityRules((prev) => ({
      ...prev,
      [benefitId]: newRules,
    }));
  };

  const handleSave = () => {
    const filteredRules: Record<string, EligibilityRule[]> = {};
    selectedBenefits.forEach((benefitId) => {
      if (eligibilityRules[benefitId] && eligibilityRules[benefitId].length > 0) {
        filteredRules[benefitId] = eligibilityRules[benefitId];
      }
    });

    updateMutation.mutate({
      benefitIds: Array.from(selectedBenefits),
      eligibilityRules: filteredRules,
    });
  };

  const activeBenefits = benefits?.filter((b) => b.isActive) || [];
  const selectedBenefitList = activeBenefits.filter((b) => selectedBenefits.has(b.id));

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
            onClick={handleSave}
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
                    <div className="flex-1">
                      <label
                        htmlFor={`benefit-${benefit.id}`}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {benefit.name}
                      </label>
                      {benefit.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {benefit.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedBenefitList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Eligibility Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Configure eligibility rules for each selected benefit. Workers must pass all rules
              to be eligible for a benefit.
            </p>
            <div className="space-y-3">
              {selectedBenefitList.map((benefit) => (
                <BenefitEligibilityConfig
                  key={benefit.id}
                  benefit={benefit}
                  rules={eligibilityRules[benefit.id] || []}
                  plugins={plugins}
                  workStatuses={workStatuses}
                  onUpdateRules={(newRules) => handleUpdateRulesForBenefit(benefit.id, newRules)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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
