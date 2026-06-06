import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { sortRatesDescending } from "@/lib/rateHistory";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ArrowLeft } from "lucide-react";
import { Link, useParams, useLocation } from "wouter";
import { RateHistorySection } from "@/components/charge-plugins/RateHistorySection";
import { baseRateHistoryEntrySchema } from "@shared/schema";
import { EmploymentStatus } from "@/lib/entity-types";
import { Employer } from "@/lib/employer-types";
import { LedgerAccountBase } from "@/lib/ledger-types";

const rateHistoryEntrySchema = baseRateHistoryEntrySchema.extend({
  rate: z.coerce.number({ invalid_type_error: "Rate is required" }),
});

const formSchema = z
  .object({
    name: z.string().optional(),
    account: z.string().uuid("Please select an account"),
    chargeTo: z.enum(["worker", "employer"]),
    employmentStatusIds: z.array(z.string()).optional(),
    specialDesignationMemberStatusIds: z.array(z.string()).optional(),
    specialDesignationMonthlyHours: z.coerce.number().min(0, "Must be zero or more"),
    rateHistory: z.array(rateHistoryEntrySchema).min(1, "At least one rate entry is required"),
    scope: z.enum(["global", "employer"]),
    employerId: z.string().optional(),
    enabled: z.boolean(),
  })
  .refine(
    (data) => {
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

interface MemberStatusOption {
  id: string;
  name: string;
  code?: string;
}

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  account: string | null;
  name: string | null;
  settings: {
    chargeTo?: "worker" | "employer";
    employmentStatusIds?: string[];
    specialDesignationMemberStatusIds?: string[];
    specialDesignationMonthlyHours?: number;
    rateHistory?: Array<{ effectiveDate: string; rate: number }>;
  };
}

export default function GbheHourlyChargeConfigFormPage() {
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

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: employmentStatuses = [] } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/options/employment-status"],
  });

  const { data: memberStatuses = [] } = useQuery<MemberStatusOption[]>({
    queryKey: ["/api/options/worker-ms"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      account: "",
      chargeTo: "employer",
      employmentStatusIds: [],
      specialDesignationMemberStatusIds: [],
      specialDesignationMonthlyHours: 135,
      rateHistory: [{ effectiveDate: "", rate: 0 }],
      scope: "global",
      employerId: "",
      enabled: false,
    },
  });

  useEffect(() => {
    if (isEditMode && existingConfig) {
      form.reset({
        name: existingConfig.name || "",
        account: existingConfig.account || "",
        chargeTo: existingConfig.settings?.chargeTo || "employer",
        employmentStatusIds: existingConfig.settings?.employmentStatusIds || [],
        specialDesignationMemberStatusIds: existingConfig.settings?.specialDesignationMemberStatusIds || [],
        specialDesignationMonthlyHours: existingConfig.settings?.specialDesignationMonthlyHours ?? 135,
        rateHistory: existingConfig.settings?.rateHistory
          ? sortRatesDescending(existingConfig.settings.rateHistory)
          : [{ effectiveDate: "", rate: 0 }],
        scope: existingConfig.scope as "global" | "employer",
        employerId: existingConfig.employerId || "",
        enabled: existingConfig.enabled,
      });
    }
  }, [isEditMode, existingConfig, form]);

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const settings = {
        chargeTo: data.chargeTo,
        employmentStatusIds: data.employmentStatusIds,
        specialDesignationMemberStatusIds: data.specialDesignationMemberStatusIds,
        specialDesignationMonthlyHours: data.specialDesignationMonthlyHours,
        rateHistory: data.rateHistory,
      };

      if (isEditMode) {
        return apiRequest("PUT", `/api/plugins/charge/configs/${configId}`, {
          enabled: data.enabled,
          name: data.name || null,
          account: data.account,
          settings,
        });
      }
      return apiRequest("POST", "/api/plugins/charge/configs", {
        pluginId: pluginId!,
        scope: data.scope,
        employerId: data.scope === "employer" ? data.employerId : undefined,
        enabled: data.enabled,
        name: data.name || null,
        account: data.account,
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
      toast({ title: "Success", description: "Configuration deleted successfully." });
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
          <p className="text-muted-foreground mt-2">GBHE Hourly Charge</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration Details</CardTitle>
          <CardDescription>Set up the GBHE hourly charge configuration with effective dates</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                              {employers.filter((e) => e.isActive).map((employer) => (
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
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-enabled" />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Optional label for this configuration"
                        value={field.value || ""}
                        onChange={field.onChange}
                        data-testid="input-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="account"
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
                        {accounts.filter((a) => a.isActive).map((account) => (
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

              <FormField
                control={form.control}
                name="chargeTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Charge To</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-charge-to">
                          <SelectValue placeholder="Select who to charge..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="worker">Worker</SelectItem>
                        <SelectItem value="employer">Employer</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                                    const current = field.value || [];
                                    field.onChange(
                                      checked
                                        ? [...current, status.id]
                                        : current.filter((id) => id !== status.id)
                                    );
                                  }}
                                  data-testid={`checkbox-employment-status-${status.code}`}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">{status.name}</FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="specialDesignationMemberStatusIds"
                render={() => (
                  <FormItem>
                    <FormLabel>Special Designation Member Statuses</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Workers with these member statuses are billed fixed monthly hours instead of actual hours
                    </p>
                    <div className="grid grid-cols-2 gap-3 p-3 border rounded-md">
                      {memberStatuses.map((status) => (
                        <FormField
                          key={status.id}
                          control={form.control}
                          name="specialDesignationMemberStatusIds"
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(status.id)}
                                  onCheckedChange={(checked) => {
                                    const current = field.value || [];
                                    field.onChange(
                                      checked
                                        ? [...current, status.id]
                                        : current.filter((id) => id !== status.id)
                                    );
                                  }}
                                  data-testid={`checkbox-member-status-${status.id}`}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">{status.name}</FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="specialDesignationMonthlyHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Special Designation Monthly Hours</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="1"
                        value={field.value ?? 135}
                        onChange={field.onChange}
                        data-testid="input-special-monthly-hours"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <RateHistorySection
                control={form.control}
                name="rateHistory"
                title="Rate History"
                columns={[
                  { key: "effectiveDate", label: "Effective Date", type: "date" },
                  { key: "rate", label: "Rate", type: "number", step: "0.01" },
                ]}
                defaultEntry={{ effectiveDate: "", rate: 0 }}
                testIdPrefix="rate"
              />

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
                    <Button type="button" variant="outline" data-testid="button-cancel">
                      Cancel
                    </Button>
                  </Link>
                  <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-config">
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
