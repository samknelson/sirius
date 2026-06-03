import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowLeft } from "lucide-react";
import { Link, useParams, useLocation } from "wouter";
import { LedgerAccountBase } from "@/lib/ledger-types";

const formSchema = z.object({
  accountId: z.string().uuid("Please select an account"),
  enabled: z.boolean(),
});

type FormData = z.infer<typeof formSchema>;

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: {
    accountId?: string;
  };
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

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: "",
      enabled: false,
    },
  });

  useEffect(() => {
    if (isEditMode && existingConfig) {
      form.reset({
        accountId: existingConfig.settings?.accountId || "",
        enabled: existingConfig.enabled,
      });
    }
  }, [isEditMode, existingConfig, form]);

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (isEditMode) {
        return apiRequest("PUT", `/api/plugins/charge/configs/${configId}`, {
          enabled: data.enabled,
          settings: {
            accountId: data.accountId,
          },
        });
      }
      return apiRequest("POST", "/api/plugins/charge/configs", {
        pluginId: pluginId!,
        scope: "global",
        enabled: data.enabled,
        settings: {
          accountId: data.accountId,
        },
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

      <Card>
        <CardHeader>
          <CardTitle>Configuration Details</CardTitle>
          <CardDescription>
            Select the ledger account that worker ECHP charges are posted to
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Enabled toggle */}
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
