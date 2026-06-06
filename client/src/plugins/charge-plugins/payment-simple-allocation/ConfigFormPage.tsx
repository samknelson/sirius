import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useEffect } from "react";
import { LedgerAccountBase } from "@/lib/ledger-types";

const formSchema = z.object({
  name: z.string().optional(),
  account: z.string().min(1, "Account is required"),
});

type FormData = z.infer<typeof formSchema>;

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  account: string | null;
  name: string | null;
  settings: Record<string, unknown>;
}

export default function PaymentSimpleAllocationConfigFormPage() {
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
      name: "",
      account: "",
    },
  });

  useEffect(() => {
    if (existingConfig && isEditMode) {
      form.reset({
        name: existingConfig.name || "",
        account: existingConfig.account || "",
      });
    }
  }, [existingConfig, isEditMode, form]);

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("POST", "/api/plugins/charge/configs", {
        pluginId,
        scope: "global",
        enabled: true,
        name: data.name || null,
        account: data.account,
        settings: {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs"] });
      toast({
        title: "Success",
        description: "Configuration created successfully.",
      });
      navigate(`/config/ledger/charge-plugins`);
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
      return apiRequest("PUT", `/api/plugins/charge/configs/${configId}`, {
        name: data.name || null,
        account: data.account,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins/charge/configs"] });
      toast({
        title: "Success",
        description: "Configuration updated successfully.",
      });
      navigate(`/config/ledger/charge-plugins`);
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
        <Link href={`/config/ledger/charge-plugins`}>
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-xl md:text-2xl font-bold" data-testid="text-page-title">
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
                Select the account that should trigger automatic ledger entry creation when payments are saved
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-account">
                          <SelectValue placeholder="Select an account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activeAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      When a cleared payment on this account is saved, a corresponding ledger entry
                      will be created with a negative amount (reducing the balance).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {activeAccounts.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No active accounts available. Please create an account first.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Link href={`/config/ledger/charge-plugins`}>
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
