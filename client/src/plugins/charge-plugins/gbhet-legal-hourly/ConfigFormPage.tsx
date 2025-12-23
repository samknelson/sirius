import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RateHistorySection } from "@/components/charge-plugins/RateHistorySection";
import { sortRatesDescending } from "@/lib/rateHistory";
import { useEffect } from "react";
import { EmploymentStatus } from "@/lib/entity-types";

const formSchema = z.object({
  accountId: z.string().min(1, "Account is required"),
  employmentStatusIds: z.array(z.string()).default([]),
  rateHistory: z.array(z.object({
    effectiveDate: z.string().min(1, "Effective date is required"),
    rate: z.number({ invalid_type_error: "Rate is required" }),
  })).min(1, "At least one rate entry is required"),
});

type FormData = z.infer<typeof formSchema>;

interface LedgerAccount {
  id: string;
  name: string;
  description: string | null;
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
    employmentStatusIds?: string[];
    rateHistory?: Array<{
      effectiveDate: string;
      rate: number;
    }>;
  };
}

export default function GbhetLegalHourlyConfigFormPage() {
  const { toast } = useToast();
  const params = useParams<{ pluginId: string; configId?: string }>();
  const [, navigate] = useLocation();
  const { pluginId, configId } = params;

  const isEditMode = !!configId;

  const { data: existingConfig, isLoading: isLoadingConfig } = useQuery<ChargePluginConfig>({
    queryKey: ["/api/charge-plugin-configs", configId],
    queryFn: async () => {
      const response = await fetch(`/api/charge-plugin-configs/${configId}`);
      if (!response.ok) throw new Error("Failed to fetch configuration");
      return response.json();
    },
    enabled: isEditMode,
  });

  const { data: accounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const { data: employmentStatuses = [] } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/employment-statuses"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: "",
      employmentStatusIds: [],
      rateHistory: [{ effectiveDate: "", rate: 0 }],
    },
  });

  useEffect(() => {
    if (existingConfig && isEditMode) {
      const rateHistory = existingConfig.settings.rateHistory && existingConfig.settings.rateHistory.length > 0
        ? sortRatesDescending(existingConfig.settings.rateHistory)
        : [{ effectiveDate: "", rate: 0 }];
      
      form.reset({
        accountId: existingConfig.settings.accountId || "",
        employmentStatusIds: existingConfig.settings.employmentStatusIds || [],
        rateHistory,
      });
    }
  }, [existingConfig, isEditMode, form]);

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("POST", "/api/charge-plugin-configs", {
        pluginId,
        scope: "global",
        enabled: true,
        settings: {
          accountId: data.accountId,
          employmentStatusIds: data.employmentStatusIds,
          rateHistory: data.rateHistory,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs"] });
      toast({
        title: "Success",
        description: "Configuration created successfully.",
      });
      navigate(`/config/ledger/charge-plugins/${pluginId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create configuration.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("PUT", `/api/charge-plugin-configs/${configId}`, {
        settings: {
          accountId: data.accountId,
          employmentStatusIds: data.employmentStatusIds,
          rateHistory: data.rateHistory,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/charge-plugin-configs"] });
      toast({
        title: "Success",
        description: "Configuration updated successfully.",
      });
      navigate(`/config/ledger/charge-plugins/${pluginId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update configuration.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    if (isEditMode) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

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
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            {isEditMode ? "Edit" : "New"} GBHET Legal Hourly Configuration
          </h1>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration Settings</CardTitle>
              <CardDescription>
                Configure the hourly rate settings for GBHET Legal benefits
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-account">
                          <SelectValue placeholder="Select an account" />
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
                    <FormDescription>
                      The ledger account where charges will be recorded
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="employmentStatusIds"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel className="text-base">Employment Status</FormLabel>
                      <FormDescription>
                        Select which employment statuses trigger this charge. Leave empty to apply to all.
                      </FormDescription>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {employmentStatuses.map((status) => (
                        <FormField
                          key={status.id}
                          control={form.control}
                          name="employmentStatusIds"
                          render={({ field }) => {
                            return (
                              <FormItem
                                key={status.id}
                                className="flex flex-row items-start space-x-3 space-y-0"
                              >
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(status.id)}
                                    onCheckedChange={(checked) => {
                                      return checked
                                        ? field.onChange([...field.value, status.id])
                                        : field.onChange(
                                            field.value?.filter(
                                              (value: string) => value !== status.id
                                            )
                                          )
                                    }}
                                    data-testid={`checkbox-status-${status.id}`}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal cursor-pointer">
                                  {status.name} ({status.code})
                                </FormLabel>
                              </FormItem>
                            )
                          }}
                        />
                      ))}
                    </div>
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
                  { key: "rate", label: "Rate ($/hr)", type: "number", step: "0.01" },
                ]}
                defaultEntry={{ effectiveDate: "", rate: 0 }}
                testIdPrefix="gbhet-legal-rate"
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Link href={`/config/ledger/charge-plugins/${pluginId}`}>
              <Button type="button" variant="outline" data-testid="button-cancel">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={isPending} data-testid="button-save">
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditMode ? "Update" : "Create"} Configuration
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
