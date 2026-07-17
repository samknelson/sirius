import { usePageTitle } from "@/contexts/PageTitleContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useVariableValue, useSetVariable } from "@/lib/use-variable";
import { Save, CalendarDays } from "lucide-react";
import { useEffect } from "react";

const configSchema = z.object({
  advanceDays: z.coerce.number().int().min(1, "Must be at least 1 day").max(365, "Cannot exceed 365 days"),
});

type ConfigFormValues = z.infer<typeof configSchema>;

const VARIABLE_NAME = "dispatch_eba_settings";

export default function DispatchEbaSettingsPage() {
  usePageTitle("EBA");
  const { toast } = useToast();

  const { data: value, isLoading } = useVariableValue(VARIABLE_NAME);

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      advanceDays: 30,
    },
  });

  useEffect(() => {
    const parsed = configSchema.safeParse(value);
    if (parsed.success) {
      form.reset(parsed.data);
    }
  }, [value, form]);

  const saveMutation = useSetVariable(VARIABLE_NAME, {
    onSuccess: () => {
      toast({
        title: "Settings saved",
        description: "EBA settings have been updated.",
      });
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
          EBA Settings
        </h1>
        <p className="text-muted-foreground">
          Configure Employer-Based Availability (EBA) settings for dispatch.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" />
                Availability Window
              </CardTitle>
              <CardDescription>
                Control how far in advance workers can set their availability dates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="advanceDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Advance Days</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        {...field}
                        data-testid="input-advance-days"
                      />
                    </FormControl>
                    <FormDescription>
                      The number of days into the future that workers can set their availability. Default is 30.
                    </FormDescription>
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
