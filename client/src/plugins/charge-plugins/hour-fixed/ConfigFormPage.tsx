import { useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Trash2, ArrowLeft } from "lucide-react";
import { Link, useParams, useLocation } from "wouter";

const rateHistoryEntrySchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  rate: z.coerce.number().positive("Rate must be positive"),
});

const formSchema = z.object({
  accountId: z.string().uuid("Please select an account"),
  employmentStatusIds: z.array(z.string()).optional(),
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

interface EmploymentStatus {
  id: string;
  name: string;
  code: string;
}

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: {
    accountId?: string;
    employmentStatusIds?: string[];
    rateHistory?: Array<{
      effectiveDate: string;
      rate: number;
    }>;
  };
}

export default function HourFixedConfigFormPage() {
  const { toast } = useToast();
  const params = useParams<{ pluginId: string; configId?: string }>();
  const [, navigate] = useLocation();
  const { pluginId, configId } = params;

  const isEditMode = !!configId;

  // Fetch existing config if editing
  const { data: existingConfig, isLoading: isLoadingConfig } = useQuery<ChargePluginConfig>({
    queryKey: ["/api/charge-plugin-configs", configId],
    queryFn: async () => {
      const response = await fetch(`/api/charge-plugin-configs/${configId}`);
      if (!response.ok) throw new Error("Failed to fetch configuration");
      return response.json();
    },
    enabled: isEditMode,
  });

  // Fetch ledger accounts
  const { data: accounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  // Fetch employers
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  // Fetch employment statuses
  const { data: employmentStatuses = [] } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/employment-statuses"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: "",
      employmentStatusIds: [],
      rateHistory: [{ effectiveDate: "", rate: 0 }],
      scope: "global",
      employerId: "",
      enabled: false,
    },
  });

  // Update form when existing config loads
  useEffect(() => {
    if (isEditMode && existingConfig) {
      form.reset({
        accountId: existingConfig.settings?.accountId || "",
        employmentStatusIds: existingConfig.settings?.employmentStatusIds || undefined,
        rateHistory: existingConfig.settings?.rateHistory || [{ effectiveDate: "", rate: 0 }],
        scope: existingConfig.scope as "global" | "employer",
        employerId: existingConfig.employerId || "",
        enabled: existingConfig.enabled,
      });
    }
  }, [isEditMode, existingConfig, form]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "rateHistory",
  });

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        pluginId: pluginId!,
        scope: data.scope,
        employerId: data.scope === "employer" ? data.employerId : undefined,
        enabled: data.enabled,
        settings: {
          accountId: data.accountId,
          employmentStatusIds: data.employmentStatusIds,
          rateHistory: data.rateHistory,
        },
      };

      if (isEditMode) {
        // Update existing config - only send defined fields in settings
        const updateSettings: any = {
          accountId: data.accountId,
          rateHistory: data.rateHistory,
        };
        
        // Only include employmentStatusIds if it's defined (not undefined)
        if (data.employmentStatusIds !== undefined) {
          updateSettings.employmentStatusIds = data.employmentStatusIds;
        }
        
        return apiRequest("PUT", `/api/charge-plugin-configs/${configId}`, {
          enabled: data.enabled,
          settings: updateSettings,
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
        description: `Configuration ${isEditMode ? 'updated' : 'created'} successfully.`,
      });
      navigate(`/config/ledger/charge-plugins/${pluginId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? 'update' : 'create'} configuration.`,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/charge-plugin-configs/${configId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs/by-plugin", pluginId] });
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs"] });
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
          <h1 className="text-3xl font-bold">
            {isEditMode ? "Edit Configuration" : "New Configuration"}
          </h1>
          <p className="text-muted-foreground mt-2">
            Hour - Fixed Rate
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration Details</CardTitle>
          <CardDescription>
            Set up the hourly rate configuration with effective dates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Scope and Employer (only for new configs) */}
              {!isEditMode && (
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

              {/* Employment Status selection */}
              <FormField
                control={form.control}
                name="employmentStatusIds"
                render={() => (
                  <FormItem>
                    <FormLabel>Employment Status</FormLabel>
                    <div className="grid grid-cols-2 gap-3 p-3 border rounded-md">
                      {employmentStatuses.map((status) => (
                        <FormField
                          key={status.id}
                          control={form.control}
                          name="employmentStatusIds"
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(status.id)}
                                  onCheckedChange={(checked) => {
                                    const currentValues = field.value || [];
                                    const newValues = checked
                                      ? [...currentValues, status.id]
                                      : currentValues.filter((id) => id !== status.id);
                                    field.onChange(newValues);
                                  }}
                                  data-testid={`checkbox-employment-status-${status.code}`}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {status.name}
                              </FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
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
                            <FormLabel>Rate</FormLabel>
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
        </CardContent>
      </Card>
    </div>
  );
}
