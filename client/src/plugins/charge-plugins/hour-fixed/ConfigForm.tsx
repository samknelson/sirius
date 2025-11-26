import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { ChargePluginConfigProps } from "../registry";

const rateHistoryEntrySchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  rate: z.coerce.number().positive("Rate must be positive"),
});

const formSchema = z.object({
  accountId: z.string().uuid("Please select an account"),
  rateHistory: z.array(rateHistoryEntrySchema).min(1, "At least one rate entry is required"),
  scope: z.enum(["global", "employer"]),
  employerId: z.string().optional(),
  enabled: z.boolean(),
}).refine(
  (data) => {
    // If scope is employer, employerId must be provided
    if (data.scope === "employer") {
      return data.employerId && data.employerId.trim().length > 0;
    }
    return true;
  },
  {
    message: "Employer must be selected for employer-scoped configuration",
    path: ["employerId"],
  }
);

type FormData = z.infer<typeof formSchema>;

interface LedgerAccount {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

interface Employer {
  id: string;
  name: string;
  isActive: boolean;
}

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: {
    accountId?: string;
    rateHistory?: Array<{
      effectiveDate: string;
      rate: number;
    }>;
  };
}

export default function HourFixedConfigForm({ pluginId }: ChargePluginConfigProps) {
  const { toast } = useToast();
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  // Fetch existing configurations for this plugin
  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<ChargePluginConfig[]>({
    queryKey: ["/api/charge-plugin-configs/by-plugin", pluginId],
    queryFn: async () => {
      const response = await fetch(`/api/charge-plugin-configs/by-plugin/${pluginId}`);
      if (!response.ok) throw new Error("Failed to fetch configurations");
      return response.json();
    },
  });

  // Fetch ledger accounts for rate history
  const { data: accounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  // Fetch employers for employer-scoped configs
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const globalConfig = configs.find(c => c.scope === "global");
  const employerConfigs = configs.filter(c => c.scope === "employer");

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: globalConfig?.settings?.accountId || "",
      rateHistory: globalConfig?.settings?.rateHistory || [{ effectiveDate: "", rate: 0 }],
      scope: "global",
      employerId: "",
      enabled: globalConfig?.enabled || false,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "rateHistory",
  });

  // Load config into form when switching between configs
  const loadConfig = (config: ChargePluginConfig | null) => {
    if (!config) {
      // New global config
      form.reset({
        accountId: "",
        rateHistory: [{ effectiveDate: "", rate: 0 }],
        scope: "global",
        employerId: "",
        enabled: false,
      });
      setSelectedConfigId(null);
    } else {
      form.reset({
        accountId: config.settings?.accountId || "",
        rateHistory: config.settings?.rateHistory || [{ effectiveDate: "", rate: 0 }],
        scope: config.scope as "global" | "employer",
        employerId: config.employerId || "",
        enabled: config.enabled,
      });
      setSelectedConfigId(config.id);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        pluginId,
        scope: data.scope,
        employerId: data.scope === "employer" ? data.employerId : undefined,
        enabled: data.enabled,
        settings: {
          accountId: data.accountId,
          rateHistory: data.rateHistory,
        },
      };

      if (selectedConfigId) {
        // Update existing config
        return apiRequest("PUT", `/api/charge-plugin-configs/${selectedConfigId}`, {
          enabled: payload.enabled,
          settings: payload.settings,
        });
      } else {
        // Create new config
        return apiRequest("POST", "/api/charge-plugin-configs", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs/by-plugin", pluginId] });
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs"] });
      toast({
        title: "Success",
        description: selectedConfigId ? "Configuration updated successfully." : "Configuration created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save configuration.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/charge-plugin-configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs/by-plugin", pluginId] });
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs"] });
      loadConfig(null);
      toast({
        title: "Success",
        description: "Configuration deleted successfully.",
      });
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

  if (isLoadingConfigs) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Hour - Fixed Rate Configuration</h2>
        <p className="text-muted-foreground mt-2">
          Configure fixed hourly rates with effective dates and ledger accounts
        </p>
      </div>

      {/* Existing configurations */}
      {configs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Existing Configurations</CardTitle>
            <CardDescription>Select a configuration to edit or create a new one</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {globalConfig && (
              <div className="flex items-center justify-between p-3 border rounded-md">
                <div>
                  <span className="font-medium">Global Configuration</span>
                  <p className="text-sm text-muted-foreground">
                    {globalConfig.settings?.rateHistory?.length || 0} rate(s) configured
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${globalConfig.enabled ? "text-green-600" : "text-muted-foreground"}`}>
                    {globalConfig.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadConfig(globalConfig)}
                    data-testid="button-edit-global"
                  >
                    Edit
                  </Button>
                </div>
              </div>
            )}
            {employerConfigs.map((config) => {
              const employer = employers.find(e => e.id === config.employerId);
              return (
                <div key={config.id} className="flex items-center justify-between p-3 border rounded-md">
                  <div>
                    <span className="font-medium">{employer?.name || config.employerId}</span>
                    <p className="text-sm text-muted-foreground">
                      {config.settings?.rateHistory?.length || 0} rate(s) configured
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${config.enabled ? "text-green-600" : "text-muted-foreground"}`}>
                      {config.enabled ? "Enabled" : "Disabled"}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => loadConfig(config)}
                      data-testid={`button-edit-${config.id}`}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Configuration form */}
      <Card>
        <CardHeader>
          <CardTitle>{selectedConfigId ? "Edit Configuration" : "New Configuration"}</CardTitle>
          <CardDescription>
            {selectedConfigId ? "Modify the selected configuration" : "Create a new configuration"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Scope and Employer */}
              {!selectedConfigId && (
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="scope"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Scope</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-scope">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="global">Global</SelectItem>
                            <SelectItem value="employer">Employer-Specific</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {form.watch("scope") === "employer" && (
                    <FormField
                      control={form.control}
                      name="employerId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Employer</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger data-testid="select-employer">
                                <SelectValue placeholder="Select employer..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {employers.filter(e => e.isActive).map((employer) => (
                                <SelectItem key={employer.id} value={employer.id}>
                                  {employer.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              {/* Enabled toggle */}
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between p-3 border rounded-md">
                    <div>
                      <FormLabel>Enabled</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        When enabled, charges will be automatically created when hours are saved
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

              {/* Account selection */}
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

              {/* Rate history */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Rate History</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ effectiveDate: "", rate: 0 })}
                    data-testid="button-add-rate"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Rate
                  </Button>
                </div>

                <div className="space-y-3">
                  {fields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-start p-3 border rounded-md">
                      <FormField
                        control={form.control}
                        name={`rateHistory.${index}.effectiveDate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Effective Date</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                {...field}
                                data-testid={`input-date-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`rateHistory.${index}.rate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Rate ($/hour)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                {...field}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                data-testid={`input-rate-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex items-end h-full pb-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(index)}
                          disabled={fields.length === 1}
                          data-testid={`button-remove-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-4 border-t">
                <div>
                  {selectedConfigId && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(selectedConfigId)}
                      disabled={deleteMutation.isPending}
                      data-testid="button-delete-config"
                    >
                      {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Delete Configuration
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  {selectedConfigId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => loadConfig(null)}
                      data-testid="button-cancel"
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={saveMutation.isPending}
                    data-testid="button-save"
                  >
                    {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {selectedConfigId ? "Update" : "Create"} Configuration
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
