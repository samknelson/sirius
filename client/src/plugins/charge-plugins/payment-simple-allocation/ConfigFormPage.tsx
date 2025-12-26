import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useEffect } from "react";
import { LedgerAccountBase } from "@/lib/ledger-types";

const formSchema = z.object({
  accountIds: z.array(z.string()).min(1, "At least one account is required"),
});

type FormData = z.infer<typeof formSchema>;

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: {
    accountIds?: string[];
  };
}

export default function PaymentSimpleAllocationConfigFormPage() {
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

  const { data: accounts = [] } = useQuery<LedgerAccountBase[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountIds: [],
    },
  });

  useEffect(() => {
    if (existingConfig && isEditMode) {
      form.reset({
        accountIds: existingConfig.settings.accountIds || [],
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
          accountIds: data.accountIds,
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
          accountIds: data.accountIds,
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

  const activeAccounts = accounts.filter(a => a.isActive);

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
            {isEditMode ? "Edit" : "New"} Payment Simple Allocation Configuration
          </h1>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration Settings</CardTitle>
              <CardDescription>
                Select which accounts should trigger automatic ledger entry creation when payments are saved
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="accountIds"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel className="text-base">Accounts</FormLabel>
                      <FormDescription>
                        Select accounts where cleared payments will automatically create ledger entries.
                        The ledger entry will have a negative amount (reducing the balance).
                      </FormDescription>
                    </div>
                    {activeAccounts.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        No active accounts available. Please create an account first.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {activeAccounts.map((account) => (
                          <FormField
                            key={account.id}
                            control={form.control}
                            name="accountIds"
                            render={({ field }) => {
                              return (
                                <FormItem
                                  key={account.id}
                                  className="flex flex-row items-start space-x-3 space-y-0 p-3 border rounded-md"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(account.id)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...field.value, account.id])
                                          : field.onChange(
                                              field.value?.filter(
                                                (value: string) => value !== account.id
                                              )
                                            )
                                      }}
                                      data-testid={`checkbox-account-${account.id}`}
                                    />
                                  </FormControl>
                                  <div className="space-y-1 leading-none">
                                    <FormLabel className="font-medium cursor-pointer">
                                      {account.name}
                                    </FormLabel>
                                    {account.description && (
                                      <p className="text-xs text-muted-foreground">
                                        {account.description}
                                      </p>
                                    )}
                                  </div>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Link href={`/config/ledger/charge-plugins/${pluginId}`}>
              <Button type="button" variant="outline" data-testid="button-cancel">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={isPending || activeAccounts.length === 0} data-testid="button-save">
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditMode ? "Update" : "Create"} Configuration
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
