import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Save, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { dispatchStatusEnum, type DispatchStatus } from "@shared/schema/dispatch/schema";

const configSchema = z.object({
  triggerStatuses: z.array(z.enum(dispatchStatusEnum)),
});

type ConfigFormValues = z.infer<typeof configSchema>;

interface ConfigResponse {
  config: ConfigFormValues;
}

const STATUS_DESCRIPTIONS: Record<DispatchStatus, string> = {
  pending: "Worker has been added to a job but not yet notified.",
  notified: "Worker has been contacted about the job.",
  accepted: "Worker has accepted the job.",
  layoff: "Worker has been laid off from the job.",
  resigned: "Worker has resigned from the job.",
  declined: "Worker has declined the job.",
};

export default function DispatchSeniorityResetConfigPage() {
  usePageTitle("Seniority Reset");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ["/api/config/dispatch/seniority-reset"],
  });

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      triggerStatuses: ["notified"],
    },
  });

  useEffect(() => {
    if (data?.config) {
      form.reset(data.config);
    }
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: async (values: ConfigFormValues) => {
      return apiRequest("PUT", "/api/config/dispatch/seniority-reset", values);
    },
    onSuccess: () => {
      toast({
        title: "Settings saved",
        description: "Seniority reset settings have been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/config/dispatch/seniority-reset"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: ConfigFormValues) => {
    saveMutation.mutate(values);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold" data-testid="text-page-title">
          Seniority Reset
        </h1>
        <p className="text-muted-foreground">
          Choose which dispatch status transitions reset a worker's seniority date.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Trigger Statuses
              </CardTitle>
              <CardDescription>
                When a worker's dispatch transitions into one of the selected statuses, their
                seniority date is reset to the current date. Leaving all unchecked disables
                seniority resets entirely.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="triggerStatuses"
                render={() => (
                  <FormItem>
                    <div className="space-y-3">
                      {dispatchStatusEnum.map((status) => (
                        <FormField
                          key={status}
                          control={form.control}
                          name="triggerStatuses"
                          render={({ field }) => (
                            <FormItem
                              className="flex flex-row items-start space-x-3 space-y-0"
                              data-testid={`row-status-${status}`}
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(status)}
                                  onCheckedChange={(checked) => {
                                    const current = field.value ?? [];
                                    if (checked) {
                                      if (!current.includes(status)) {
                                        field.onChange([...current, status]);
                                      }
                                    } else {
                                      field.onChange(current.filter((s) => s !== status));
                                    }
                                  }}
                                  data-testid={`checkbox-status-${status}`}
                                />
                              </FormControl>
                              <div className="space-y-1 leading-none">
                                <FormLabel className="capitalize">{status}</FormLabel>
                                <FormDescription>{STATUS_DESCRIPTIONS[status]}</FormDescription>
                              </div>
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

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              data-testid="button-save"
            >
              <Save className="h-4 w-4 mr-2" />
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
