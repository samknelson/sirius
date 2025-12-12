import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RateHistorySection } from "@/components/charge-plugins/RateHistorySection";
import { sortRatesDescending } from "@/lib/rateHistory";
import { useEffect } from "react";

const formSchema = z.object({
  accountId: z.string().min(1, "Account is required"),
  benefitId: z.string().min(1, "Benefit is required"),
  billingOffsetMonths: z.number().int().default(-3),
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

interface TrustBenefit {
  id: string;
  name: string;
}

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: {
    accountId?: string;
    benefitId?: string;
    billingOffsetMonths?: number;
    rateHistory?: Array<{
      effectiveDate: string;
      rate: number;
    }>;
  };
}

export default function GbhetLegalBenefitConfigFormPage() {
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

  const { data: benefits = [] } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: "",
      benefitId: "",
      billingOffsetMonths: -3,
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
        benefitId: existingConfig.settings.benefitId || "",
        billingOffsetMonths: existingConfig.settings.billingOffsetMonths ?? -3,
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
          benefitId: data.benefitId,
          billingOffsetMonths: data.billingOffsetMonths,
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
          benefitId: data.benefitId,
          billingOffsetMonths: data.billingOffsetMonths,
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
            {isEditMode ? "Edit" : "New"} GBHET Legal Benefit Configuration
          </h1>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration Settings</CardTitle>
              <CardDescription>
                Configure the monthly rate settings for GBHET Legal benefits. Charges are created when workers have the selected benefit for a given month.
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
                name="benefitId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trust Benefit</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-benefit">
                          <SelectValue placeholder="Select a trust benefit" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {benefits.map((benefit) => (
                          <SelectItem key={benefit.id} value={benefit.id}>
                            {benefit.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The trust benefit that triggers this charge when a worker has it for a given month
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="billingOffsetMonths"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing Offset (Months)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                        data-testid="input-billing-offset"
                      />
                    </FormControl>
                    <FormDescription>
                      Number of months to offset from benefit month for billing. Use -3 to bill 3 months before the benefit is granted (e.g., bill in January for April benefits).
                    </FormDescription>
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
                  { key: "rate", label: "Rate ($/month)", type: "number", step: "0.01" },
                ]}
                defaultEntry={{ effectiveDate: "", rate: 0 }}
                testIdPrefix="gbhet-legal-benefit-rate"
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
