import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowLeft, Plus, Trash2, RotateCcw, ChevronsUpDown } from "lucide-react";
import { Link, useParams, useLocation } from "wouter";
import { LedgerAccountBase } from "@/lib/ledger-types";
import {
  baoEchpChargeSettingsSchema,
  DEFAULT_BAO_ECHP_BREAKPOINTS,
} from "@shared/schema/sitespecific/bao/schema";

const formSchema = baoEchpChargeSettingsSchema.extend({
  accountId: z.string().uuid("Please select an account"),
  enabled: z.boolean(),
});

type FormData = z.infer<typeof formSchema>;

interface PolicyOption {
  id: string;
  siriusId: string;
  name: string | null;
}

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: {
    accountId?: string;
    rules?: FormData["rules"];
  };
}

function policyLabel(policy: PolicyOption): string {
  return policy.name?.trim() ? policy.name : policy.siriusId;
}

function PolicyMultiSelect({
  value,
  onChange,
  policies,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  policies: PolicyOption[];
}) {
  const selected = policies.filter((p) => value.includes(p.id));

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          data-testid="button-select-policies"
        >
          <span className="truncate text-left">
            {selected.length === 0
              ? "Select policies..."
              : `${selected.length} ${selected.length === 1 ? "policy" : "policies"} selected`}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search policies..." data-testid="input-policy-search" />
          <CommandList>
            <CommandEmpty>No policies found.</CommandEmpty>
            <CommandGroup>
              {policies.map((policy) => (
                <CommandItem
                  key={policy.id}
                  value={`${policyLabel(policy)} ${policy.siriusId}`}
                  onSelect={() => toggle(policy.id)}
                  data-testid={`option-policy-${policy.id}`}
                >
                  <Checkbox
                    checked={value.includes(policy.id)}
                    className="mr-2"
                    tabIndex={-1}
                  />
                  <span className="truncate">{policyLabel(policy)}</span>
                  {policy.name?.trim() && (
                    <span className="ml-2 text-xs text-muted-foreground">{policy.siriusId}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function BreakpointEditor({
  control,
  ruleIndex,
}: {
  control: Control<FormData>;
  ruleIndex: number;
}) {
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: `rules.${ruleIndex}.breakpoints`,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FormLabel>Price ladder</FormLabel>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => replace(DEFAULT_BAO_ECHP_BREAKPOINTS)}
            data-testid={`button-reset-breakpoints-${ruleIndex}`}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Reset to defaults
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ maxHoursWorked: 0, price: 0 })}
            data-testid={`button-add-breakpoint-${ruleIndex}`}
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add breakpoint
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A worker pays the price of the first breakpoint (lowest hours first) whose
        "hours worked under" is greater than their hours worked in the month.
      </p>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
        <span>Hours worked under</span>
        <span>Price ($)</span>
        <span />
      </div>
      {fields.map((bp, bpIndex) => (
        <div key={bp.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start">
          <FormField
            control={control}
            name={`rules.${ruleIndex}.breakpoints.${bpIndex}.maxHoursWorked`}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    type="number"
                    step="any"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                    data-testid={`input-breakpoint-hours-${ruleIndex}-${bpIndex}`}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`rules.${ruleIndex}.breakpoints.${bpIndex}.price`}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    type="number"
                    step="any"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                    data-testid={`input-breakpoint-price-${ruleIndex}-${bpIndex}`}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(bpIndex)}
            data-testid={`button-remove-breakpoint-${ruleIndex}-${bpIndex}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function BaoEchpConfigFormPage() {
  const { toast } = useToast();
  const params = useParams<{ pluginId: string; configId?: string }>();
  const [, navigate] = useLocation();
  const { pluginId, configId } = params;

  const isEditMode = !!configId;

  const { data: existingConfig, isLoading: isLoadingConfig } = useQuery<ChargePluginConfig>({
    queryKey: ["/api/plugins/charge/configs", configId],
    queryFn: async () => {
      const response = await fetch(`/api/plugins/charge/configs/${configId}`);
      if (!response.ok) throw new Error("Failed to fetch configuration");
      return response.json();
    },
    enabled: isEditMode,
  });

  const { data: accounts = [] } = useQuery<LedgerAccountBase[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const { data: policies = [] } = useQuery<PolicyOption[]>({
    queryKey: ["/api/policies"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: "",
      enabled: false,
      rules: [],
    },
  });

  const { fields: ruleFields, append: appendRule, remove: removeRule } = useFieldArray({
    control: form.control,
    name: "rules",
  });

  useEffect(() => {
    if (isEditMode && existingConfig) {
      form.reset({
        accountId: existingConfig.settings?.accountId || "",
        enabled: existingConfig.enabled,
        rules: existingConfig.settings?.rules ?? [],
      });
    }
  }, [isEditMode, existingConfig, form]);

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const settings = { accountId: data.accountId, rules: data.rules };
      if (isEditMode) {
        return apiRequest("PUT", `/api/plugins/charge/configs/${configId}`, {
          enabled: data.enabled,
          settings,
        });
      }
      return apiRequest("POST", "/api/plugins/charge/configs", {
        pluginId: pluginId!,
        scope: "global",
        enabled: data.enabled,
        settings,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs/by-plugin", pluginId] });
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs"] });
      toast({
        title: "Success",
        description: `Configuration ${isEditMode ? "updated" : "created"} successfully.`,
      });
      navigate(`/config/ledger/charge-plugins/${pluginId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} configuration.`,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/plugins/charge/configs/${configId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs/by-plugin", pluginId] });
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs"] });
      toast({
        title: "Success",
        description: "Configuration deleted successfully.",
      });
      navigate(`/config/ledger/charge-plugins/${pluginId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete configuration.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    saveMutation.mutate(data);
  };

  if (isEditMode && isLoadingConfig) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/config/ledger/charge-plugins/${pluginId}`}>
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {isEditMode ? "Edit Configuration" : "New Configuration"}
          </h1>
          <p className="text-muted-foreground mt-2">
            BAO - Event Center Hours Purchase Charge
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration Details</CardTitle>
              <CardDescription>
                Select the ledger account that worker ECHP charges are posted to
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between p-3 border rounded-md">
                    <div>
                      <FormLabel>Enabled</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        When enabled, charges are automatically created when an ECHP hours entry is saved
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-enabled"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-account">
                          <SelectValue placeholder="Select account..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {accounts.filter(a => a.isActive).map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Pricing Rules</CardTitle>
                  <CardDescription>
                    Each rule applies a price ladder to one or more policies. A
                    policy may appear in several rules; the worker is shown every
                    matching price and billed the lowest.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    appendRule({ policyIds: [], breakpoints: DEFAULT_BAO_ECHP_BREAKPOINTS })
                  }
                  data-testid="button-add-rule"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add rule
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {ruleFields.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="text-no-rules">
                  No pricing rules yet. Add a rule to let policies purchase Event
                  Center hours.
                </p>
              )}
              {ruleFields.map((rule, ruleIndex) => (
                <div
                  key={rule.id}
                  className="space-y-4 rounded-lg border p-4"
                  data-testid={`section-rule-${ruleIndex}`}
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">Rule {ruleIndex + 1}</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRule(ruleIndex)}
                      data-testid={`button-remove-rule-${ruleIndex}`}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove rule
                    </Button>
                  </div>

                  <FormField
                    control={form.control}
                    name={`rules.${ruleIndex}.policyIds`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Policies</FormLabel>
                        <PolicyMultiSelect
                          value={field.value ?? []}
                          onChange={field.onChange}
                          policies={policies}
                        />
                        {(field.value?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {(field.value ?? []).map((id) => {
                              const policy = policies.find((p) => p.id === id);
                              return (
                                <Badge
                                  key={id}
                                  variant="outline"
                                  data-testid={`badge-rule-policy-${ruleIndex}-${id}`}
                                >
                                  {policy ? policyLabel(policy) : id}
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <BreakpointEditor control={form.control} ruleIndex={ruleIndex} />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between pt-4 border-t">
            <div>
              {isEditMode && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  data-testid="button-delete-config"
                >
                  {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete Configuration
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Link href={`/config/ledger/charge-plugins/${pluginId}`}>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={saveMutation.isPending}
                data-testid="button-save-config"
              >
                {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditMode ? "Update" : "Create"} Configuration
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
