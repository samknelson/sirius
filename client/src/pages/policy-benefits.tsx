import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import type { JsonSchema } from "@shared/json-schema-form";
import { SchemaForm } from "@/components/json-schema-form";
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
  configSchema?: JsonSchema;
}

/**
 * True when the plugin schema has at least one configurable property.
 * Plugins like "always-eligible" emit an empty-object schema and we
 * skip rendering an empty form for them.
 */
function hasConfigProps(schema: JsonSchema | undefined): boolean {
  if (!schema) return false;
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  return !!props && Object.keys(props).length > 0;
}

function EligibilityRuleEditor({
  rule,
  plugins,
  onUpdate,
  onRemove,
}: {
  rule: EligibilityRule;
  plugins: EligibilityPlugin[];
  onUpdate: (updatedRule: EligibilityRule) => void;
  onRemove: () => void;
}) {
  const plugin = plugins.find((p) => p.id === rule.pluginKey);
  const configSchema = plugin?.configSchema;

  const handleAppliesToChange = (scanType: "start" | "continue", checked: boolean) => {
    const nextAppliesTo = checked
      ? [...rule.appliesTo, scanType]
      : rule.appliesTo.filter((t) => t !== scanType);
    const finalAppliesTo = nextAppliesTo.length > 0 ? nextAppliesTo : ["start"];
    // Mirror into rule.config so any code path that reads
    // config.appliesTo (legacy validators, persisted shape) stays in
    // lockstep with the top-level rule.appliesTo. They were drifting.
    onUpdate({
      ...rule,
      appliesTo: finalAppliesTo,
      config: { ...rule.config, appliesTo: finalAppliesTo },
    });
  };

  const handleConfigChange = (newConfig: Record<string, unknown>) => {
    onUpdate({ ...rule, config: newConfig });
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

      {hasConfigProps(configSchema) && configSchema && (
        <SchemaForm
          schema={configSchema}
          formData={rule.config}
          onChange={(e) => handleConfigChange(e.formData as Record<string, unknown>)}
          // Suppress the built-in submit button — saves happen via the page-level Save action.
          uiSchema={{ "ui:submitButtonOptions": { norender: true } }}
        />
      )}
    </div>
  );
}

function BenefitEligibilityConfig({
  benefit,
  rules,
  plugins,
  onUpdateRules,
}: {
  benefit: TrustBenefit;
  rules: EligibilityRule[];
  plugins: EligibilityPlugin[];
  onUpdateRules: (newRules: EligibilityRule[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<string>("");

  const handleAddRule = () => {
    if (!selectedPlugin) return;

    // Defaults now live in the plugin's JSON Schema (via AJV's
    // useDefaults), so we start with an empty config and let the
    // SchemaForm hydrate defaults on first render.
    const newRule: EligibilityRule = {
      pluginKey: selectedPlugin,
      appliesTo: ["start", "continue"],
      config: { appliesTo: ["start", "continue"] },
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

  // AJV validator cache, keyed by pluginKey, so each rule's config can
  // be validated against its own JSON Schema before saving. The page
  // doesn't render an in-form submit button (saves happen at the page
  // level), so this is the gate that enforces schema validity.
  const validators = useMemo(() => {
    const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
    addFormats(ajv);
    const out = new Map<string, ValidateFunction>();
    for (const p of plugins) {
      if (!p.configSchema) continue;
      try {
        out.set(p.id, ajv.compile(p.configSchema as object));
      } catch {
        // Bad schema from server — skip; save will surface a generic error.
      }
    }
    return out;
  }, [plugins]);

  const handleSave = () => {
    const filteredRules: Record<string, EligibilityRule[]> = {};
    const errors: string[] = [];

    selectedBenefits.forEach((benefitId) => {
      const rules = eligibilityRules[benefitId];
      if (!rules || rules.length === 0) return;

      const benefitName =
        activeBenefits.find((b) => b.id === benefitId)?.name ?? benefitId;

      rules.forEach((rule, idx) => {
        const validate = validators.get(rule.pluginKey);
        if (!validate) return;
        const ok = validate(rule.config);
        if (!ok && validate.errors) {
          const pluginName =
            plugins.find((p) => p.id === rule.pluginKey)?.name ?? rule.pluginKey;
          for (const e of validate.errors) {
            errors.push(
              `${benefitName} → ${pluginName} (rule ${idx + 1}): ${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
            );
          }
        }
      });

      filteredRules[benefitId] = rules;
    });

    if (errors.length > 0) {
      toast({
        title: "Cannot save: invalid eligibility rules",
        description: errors.slice(0, 5).join("\n"),
        variant: "destructive",
      });
      return;
    }

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
