import { type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { GRIEVANCE_CARDINALITIES, type GrievanceCardinality } from "@shared/schema";

interface OptionItem {
  id: string;
  name: string;
  isActive?: boolean;
}

export const GRIEVANCE_CARDINALITY_LABELS: Record<GrievanceCardinality, string> = {
  individual: "Individual",
  multiple: "Multiple",
  "multiple-with-lead": "Multiple with lead",
  class: "Class",
};

const grievanceFormSchema = z.object({
  complaint: z.string().optional(),
  remedy: z.string().optional(),
  classDescription: z.string().optional(),
  cardinality: z.enum(GRIEVANCE_CARDINALITIES),
  statusId: z.string().uuid("Please select a status"),
  categoryId: z.string().uuid("Please select a category"),
});

export type GrievanceFormValues = z.infer<typeof grievanceFormSchema>;

interface GrievanceFormProps {
  defaultValues?: Partial<GrievanceFormValues>;
  onSubmit: (values: GrievanceFormValues) => Promise<void> | void;
  submitLabel: string;
  isSubmitting?: boolean;
  onCardinalityChange?: (cardinality: GrievanceCardinality) => void;
  renderWorkerSection?: (cardinality: GrievanceCardinality) => ReactNode;
}

export function GrievanceForm({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
  onCardinalityChange,
  renderWorkerSection,
}: GrievanceFormProps) {
  const { data: statuses = [] } = useQuery<OptionItem[]>({
    queryKey: ["/api/options/grievance-status"],
  });
  const { data: categories = [] } = useQuery<OptionItem[]>({
    queryKey: ["/api/options/grievance-category"],
  });

  const form = useForm<GrievanceFormValues>({
    resolver: zodResolver(grievanceFormSchema),
    defaultValues: {
      complaint: defaultValues?.complaint ?? "",
      remedy: defaultValues?.remedy ?? "",
      classDescription: defaultValues?.classDescription ?? "",
      cardinality: defaultValues?.cardinality ?? "individual",
      statusId: defaultValues?.statusId ?? "",
      categoryId: defaultValues?.categoryId ?? "",
    },
  });

  const cardinality = form.watch("cardinality");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="categoryId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-grievance-category">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {categories
                    .filter((c) => c.isActive !== false)
                    .map((c) => (
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

        <FormField
          control={form.control}
          name="statusId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-grievance-status">
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {statuses
                    .filter((s) => s.isActive !== false)
                    .map((s) => (
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

        <FormField
          control={form.control}
          name="cardinality"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cardinality</FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  onCardinalityChange?.(value as GrievanceCardinality);
                }}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-grievance-cardinality">
                    <SelectValue placeholder="Select cardinality" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {GRIEVANCE_CARDINALITIES.map((c) => (
                    <SelectItem key={c} value={c} data-testid={`option-cardinality-${c}`}>
                      {GRIEVANCE_CARDINALITY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="complaint"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Complaint</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  placeholder="Describe the complaint"
                  data-testid="input-grievance-complaint"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="remedy"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Remedy</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  placeholder="Describe the requested remedy"
                  data-testid="input-grievance-remedy"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {cardinality === "class" ? (
          <FormField
            control={form.control}
            name="classDescription"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Class Description</FormLabel>
                <FormControl>
                  <Textarea
                    rows={6}
                    placeholder="Describe the affected class"
                    data-testid="input-grievance-class-description"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          renderWorkerSection?.(cardinality)
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting} data-testid="button-submit-grievance">
            {isSubmitting ? "Saving..." : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
