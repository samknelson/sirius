import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Users, Plus, Trash2, Save } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAccessCheck } from "@/hooks/use-access-check";
import {
  baoBeneficiaryListSchema,
  BAO_BENEFICIARY_PERCENT_EPSILON,
  type BaoBeneficiaryList,
} from "@shared/schema/sitespecific/bao/schema";

const formSchema = z.object({
  beneficiaries: baoBeneficiaryListSchema,
});

type FormValues = z.infer<typeof formSchema>;

const emptyBeneficiary = {
  name: "",
  ssn: "",
  phone: "",
  address: "",
  relationship: "",
  percent: 0,
};

function BeneficiariesContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { canAccess: canEdit } = useAccessCheck("worker.mine", worker.id);

  const { data: beneficiaries, isLoading } = useQuery<BaoBeneficiaryList>({
    queryKey: ["/api/sitespecific/bao/beneficiaries/worker", worker.id],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { beneficiaries: [] },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "beneficiaries",
  });

  useEffect(() => {
    if (beneficiaries) {
      form.reset({
        beneficiaries: beneficiaries.map((b) => ({
          name: b.name ?? "",
          ssn: b.ssn ?? "",
          phone: b.phone ?? "",
          address: b.address ?? "",
          relationship: b.relationship ?? "",
          percent: b.percent ?? 0,
        })),
      });
    }
  }, [beneficiaries, form]);

  const watched = form.watch("beneficiaries");
  const total = (watched ?? []).reduce(
    (sum, b) => sum + (Number.isFinite(b?.percent) ? b.percent : 0),
    0,
  );
  const totalIsValid =
    fields.length === 0 || Math.abs(total - 100) <= BAO_BENEFICIARY_PERCENT_EPSILON;

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      return apiRequest(
        "PUT",
        `/api/sitespecific/bao/beneficiaries/worker/${worker.id}`,
        values.beneficiaries,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/sitespecific/bao/beneficiaries/worker", worker.id],
      });
      toast({
        title: "Beneficiaries saved",
        description: "The beneficiary list has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save",
        description: error.message || "Could not save beneficiaries.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: FormValues) => {
    saveMutation.mutate(values);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Users className="text-primary" size={20} />
            </div>
            <div>
              <CardTitle data-testid="text-beneficiaries-title">Beneficiaries</CardTitle>
              <CardDescription>
                Designate beneficiaries and their percentage shares. Percentages
                must total 100%.
              </CardDescription>
            </div>
          </div>
          <div
            className={`text-sm font-medium ${
              totalIsValid ? "text-muted-foreground" : "text-destructive"
            }`}
            data-testid="text-percent-total"
          >
            Total: {total}%
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {fields.length === 0 ? (
              <div
                className="text-center py-10 text-muted-foreground border border-dashed rounded-lg"
                data-testid="text-no-beneficiaries"
              >
                No beneficiaries yet. Add one to get started.
              </div>
            ) : (
              <div className="space-y-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="rounded-lg border border-border p-4"
                    data-testid={`row-beneficiary-${index}`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <h4 className="text-sm font-semibold text-foreground">
                        Beneficiary {index + 1}
                      </h4>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(index)}
                          data-testid={`button-remove-beneficiary-${index}`}
                        >
                          <Trash2 size={16} className="text-destructive" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={`beneficiaries.${index}.name`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                disabled={!canEdit}
                                data-testid={`input-name-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`beneficiaries.${index}.relationship`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Relationship</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value ?? ""}
                                disabled={!canEdit}
                                data-testid={`input-relationship-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`beneficiaries.${index}.ssn`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SSN</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value ?? ""}
                                disabled={!canEdit}
                                data-testid={`input-ssn-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`beneficiaries.${index}.phone`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value ?? ""}
                                disabled={!canEdit}
                                data-testid={`input-phone-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`beneficiaries.${index}.address`}
                        render={({ field }) => (
                          <FormItem className="md:col-span-1">
                            <FormLabel>Address</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value ?? ""}
                                disabled={!canEdit}
                                data-testid={`input-address-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`beneficiaries.${index}.percent`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Percent</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min={0}
                                max={100}
                                value={
                                  field.value === undefined || field.value === null
                                    ? ""
                                    : field.value
                                }
                                onChange={(e) =>
                                  field.onChange(
                                    e.target.value === ""
                                      ? 0
                                      : e.target.valueAsNumber,
                                  )
                                }
                                disabled={!canEdit}
                                data-testid={`input-percent-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {form.formState.errors.beneficiaries?.root && (
              <p
                className="text-sm font-medium text-destructive"
                data-testid="text-list-error"
              >
                {form.formState.errors.beneficiaries.root.message}
              </p>
            )}

            {canEdit && (
              <div className="flex items-center justify-between gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => append({ ...emptyBeneficiary })}
                  data-testid="button-add-beneficiary"
                >
                  <Plus size={16} className="mr-2" />
                  Add Beneficiary
                </Button>
                <Button
                  type="submit"
                  disabled={saveMutation.isPending}
                  data-testid="button-save-beneficiaries"
                >
                  <Save size={16} className="mr-2" />
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function WorkerBaoBeneficiariesPage() {
  return (
    <WorkerLayout activeTab="sitespecific-bao-beneficiaries">
      <BeneficiariesContent />
    </WorkerLayout>
  );
}
