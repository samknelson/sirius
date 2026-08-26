import { useState } from "react";
import { Gavel } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { GrievanceWorkerSection, type SectionWorker, type WorkerSearchHit } from "@/components/grievances/grievance-worker-section";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OptionItem {
  id: string;
  name: string;
}

interface BenefitItem {
  id: string;
  name: string;
  providerId: string | null;
  providerName: string | null;
}

const appealFormSchema = z.object({
  categoryId: z.string().uuid("Please select a category"),
  statusId: z.string().uuid("Please select a status"),
  benefitId: z.string().uuid("Please select a benefit"),
  denialReasonId: z.string().uuid("Please select a denial reason"),
});

type AppealFormValues = z.infer<typeof appealFormSchema>;

export default function GrievancesAppealAdd() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [worker, setWorker] = useState<SectionWorker | null>(null);

  const { data: categories = [] } = useQuery<OptionItem[]>({
    queryKey: ["/api/options/grievance-category"],
  });
  const { data: statuses = [] } = useQuery<OptionItem[]>({
    queryKey: ["/api/options/grievance-status"],
  });
  const { data: benefits = [], isLoading: benefitsLoading } = useQuery<BenefitItem[]>({
    queryKey: ["/api/grievances/appeal/benefits"],
  });
  const { data: denialReasons = [], isLoading: reasonsLoading } = useQuery<OptionItem[]>({
    queryKey: ["/api/options/grievance-denial-reason"],
  });

  const form = useForm<AppealFormValues>({
    resolver: zodResolver(appealFormSchema),
    defaultValues: { categoryId: "", statusId: "", benefitId: "", denialReasonId: "" },
  });

  const selectedBenefitId = form.watch("benefitId");
  const selectedBenefit = benefits.find((b) => b.id === selectedBenefitId);

  const addWorker = (hit: WorkerSearchHit) => {
    setWorker({ workerId: hit.id, siriusId: hit.siriusId, displayName: hit.displayName, primary: true });
  };
  const removeWorker = () => setWorker(null);

  const handleSubmit = async (values: AppealFormValues) => {
    if (!worker) {
      toast({ title: "A worker is required for an appeal", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await apiRequest("POST", "/api/grievances/appeal", {
        categoryId: values.categoryId,
        statusId: values.statusId,
        workerId: worker.workerId,
        benefitId: values.benefitId,
        denialReasonId: values.denialReasonId,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
      toast({
        title: "Appeal created",
        description: "Upload the appeal letter on the Files tab.",
      });
      navigate(`/grievance/${created.id}/files`);
    } catch (error: any) {
      toast({
        title: "Failed to create appeal",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabs = [
    { id: "list", label: "List", href: "/grievances" },
    { id: "add", label: "Add Grievance", href: "/grievances/add" },
    { id: "appeal", label: "Add Appeal", href: "/grievances/appeal" },
  ];

  const noDenialReasons = !reasonsLoading && denialReasons.length === 0;

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="Add Appeal"
        icon={<Gavel className="text-primary-foreground" size={16} />}
        backLink={{ href: "/grievances", label: "Back to Grievances" }}
      />

      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => (
              <Link key={tab.id} href={tab.href}>
                <Button
                  variant={tab.id === "appeal" ? "default" : "outline"}
                  size="sm"
                  data-testid={`button-grievances-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {noDenialReasons && (
          <Alert className="mb-6" data-testid="alert-no-denial-reasons">
            <AlertDescription>
              No denial reasons are configured. Go to{" "}
              <Link href="/config/options/grievance-denial-reason" className="underline">
                Options → Appeal Denial Reasons
              </Link>{" "}
              and add at least one before recording an appeal.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="pt-6 max-w-2xl">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">

                {/* Worker — required, single */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Worker <span className="text-destructive">*</span>
                  </label>
                  <GrievanceWorkerSection
                    cardinality="individual"
                    workers={worker ? [worker] : []}
                    onAdd={addWorker}
                    onRemove={removeWorker}
                    onSetPrimary={() => {}}
                    busy={isSubmitting}
                  />
                  {!worker && (
                    <p className="text-sm text-muted-foreground mt-1" data-testid="text-worker-required">
                      Select the worker who filed the appeal.
                    </p>
                  )}
                </div>

                {/* Category */}
                <FormField
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-appeal-category">
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={c.id} data-testid={`option-category-${c.id}`}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Initial Status */}
                <FormField
                  control={form.control}
                  name="statusId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Initial Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-appeal-status">
                            <SelectValue placeholder="Select a status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {statuses.map((s) => (
                            <SelectItem key={s.id} value={s.id} data-testid={`option-status-${s.id}`}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Benefit (denied) */}
                <FormField
                  control={form.control}
                  name="benefitId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Denied Benefit</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={benefitsLoading}>
                        <FormControl>
                          <SelectTrigger data-testid="select-appeal-benefit">
                            <SelectValue placeholder={benefitsLoading ? "Loading…" : "Select a benefit"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {benefits.map((b) => (
                            <SelectItem key={b.id} value={b.id} data-testid={`option-benefit-${b.id}`}>
                              {b.name}
                              {b.providerName ? ` — ${b.providerName}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedBenefit && (
                        <p className="text-sm text-muted-foreground" data-testid="text-benefit-carrier">
                          Carrier:{" "}
                          <span className="font-medium">
                            {selectedBenefit.providerName ?? "No carrier on file"}
                          </span>
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Denial Reason */}
                <FormField
                  control={form.control}
                  name="denialReasonId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Denial Reason</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={reasonsLoading || noDenialReasons}>
                        <FormControl>
                          <SelectTrigger data-testid="select-appeal-denial-reason">
                            <SelectValue placeholder={reasonsLoading ? "Loading…" : noDenialReasons ? "No reasons configured" : "Select a denial reason"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {denialReasons.map((r) => (
                            <SelectItem key={r.id} value={r.id} data-testid={`option-denial-reason-${r.id}`}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <p className="text-sm text-muted-foreground" data-testid="text-letter-note">
                  After saving, upload the appeal letter on the <strong>Files</strong> tab of the
                  new grievance.
                </p>

                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={isSubmitting || noDenialReasons}
                    data-testid="button-submit-appeal"
                  >
                    {isSubmitting ? "Creating…" : "Create Appeal"}
                  </Button>
                  <Link href="/grievances">
                    <Button type="button" variant="outline" data-testid="button-cancel-appeal">
                      Cancel
                    </Button>
                  </Link>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
