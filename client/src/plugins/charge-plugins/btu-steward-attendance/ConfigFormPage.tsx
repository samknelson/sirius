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
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useEffect } from "react";

const formSchema = z.object({
  accountId: z.string().min(1, "Account is required"),
  amount: z.number({ invalid_type_error: "Amount is required" }).positive("Amount must be positive"),
  eventTypeIds: z.array(z.string()).min(1, "At least one event type is required"),
  attendedStatuses: z.array(z.string()).min(1, "At least one status is required"),
});

type FormData = z.infer<typeof formSchema>;

interface LedgerAccount {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

interface EventType {
  id: string;
  name: string;
  category: string;
}

interface ChargePluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  settings: {
    accountId?: string;
    amount?: number;
    eventTypeIds?: string[];
    attendedStatuses?: string[];
  };
}

const AVAILABLE_STATUSES = [
  { value: "attended", label: "Attended" },
  { value: "registered", label: "Registered" },
  { value: "confirmed", label: "Confirmed" },
];

export default function BtuStewardAttendanceConfigFormPage() {
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

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/event-types"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: "",
      amount: 1,
      eventTypeIds: [],
      attendedStatuses: ["attended"],
    },
  });

  useEffect(() => {
    if (existingConfig && isEditMode) {
      form.reset({
        accountId: existingConfig.settings.accountId || "",
        amount: existingConfig.settings.amount ?? 1,
        eventTypeIds: existingConfig.settings.eventTypeIds || [],
        attendedStatuses: existingConfig.settings.attendedStatuses || ["attended"],
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
          amount: data.amount,
          eventTypeIds: data.eventTypeIds,
          attendedStatuses: data.attendedStatuses,
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
          amount: data.amount,
          eventTypeIds: data.eventTypeIds,
          attendedStatuses: data.attendedStatuses,
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
            {isEditMode ? "Edit" : "New"} BTU Steward Attendance Configuration
          </h1>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration Settings</CardTitle>
              <CardDescription>
                Configure the settings for awarding attendance points to shop stewards when they attend selected event types.
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
                      The ledger account where attendance points will be recorded
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Points per Attendance</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        data-testid="input-amount"
                      />
                    </FormControl>
                    <FormDescription>
                      Number of points to credit for each qualifying attendance (creates a negative/credit entry in the ledger)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="eventTypeIds"
                render={() => (
                  <FormItem>
                    <FormLabel>Event Types</FormLabel>
                    <FormDescription>
                      Select the event types that qualify for attendance points
                    </FormDescription>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      {eventTypes.map((eventType) => (
                        <FormField
                          key={eventType.id}
                          control={form.control}
                          name="eventTypeIds"
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-3 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(eventType.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      field.onChange([...field.value, eventType.id]);
                                    } else {
                                      field.onChange(field.value.filter((id: string) => id !== eventType.id));
                                    }
                                  }}
                                  data-testid={`checkbox-event-type-${eventType.id}`}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {eventType.name}
                                <span className="text-muted-foreground ml-2 text-xs">({eventType.category})</span>
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

              <FormField
                control={form.control}
                name="attendedStatuses"
                render={() => (
                  <FormItem>
                    <FormLabel>Qualifying Statuses</FormLabel>
                    <FormDescription>
                      Select which participation statuses count as "attended"
                    </FormDescription>
                    <div className="flex flex-wrap gap-4 mt-2">
                      {AVAILABLE_STATUSES.map((status) => (
                        <FormField
                          key={status.value}
                          control={form.control}
                          name="attendedStatuses"
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-3 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(status.value)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      field.onChange([...field.value, status.value]);
                                    } else {
                                      field.onChange(field.value.filter((s: string) => s !== status.value));
                                    }
                                  }}
                                  data-testid={`checkbox-status-${status.value}`}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {status.label}
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
