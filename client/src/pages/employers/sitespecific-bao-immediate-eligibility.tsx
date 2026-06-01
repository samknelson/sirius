import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2, Plus, Pencil, Trash2, CalendarClock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { BaoEmployerImmediateEligibility } from "@shared/schema/sitespecific/bao/schema";

const formSchema = z
  .object({
    startYmd: z.string().min(1, "Start date is required"),
    endYmd: z.string().min(1, "End date is required"),
  })
  .superRefine((val, ctx) => {
    if (val.startYmd && val.endYmd && val.endYmd <= val.startYmd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endYmd"],
        message: "End date must be after the start date",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

function formatYmd(value: string | null | undefined): string {
  if (!value) return "—";
  const ymd = value.slice(0, 10);
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return ymd;
  const [, year, month, day] = match;
  return `${parseInt(month)}/${parseInt(day)}/${year}`;
}

function ImmediateEligibilityContent() {
  const { employer } = useEmployerLayout();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: eligibility, isLoading, error } = useQuery<BaoEmployerImmediateEligibility | null>({
    queryKey: ["/api/sitespecific/bao/immediate-eligibility/employer", employer.id],
    queryFn: async () => {
      const response = await fetch(`/api/sitespecific/bao/immediate-eligibility/employer/${employer.id}`);
      if (!response.ok) {
        if (response.status === 503) {
          return null;
        }
        throw new Error("Failed to fetch immediate eligibility");
      }
      return response.json();
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      startYmd: "",
      endYmd: "",
    },
  });

  useEffect(() => {
    if (isEditing && eligibility) {
      form.reset({
        startYmd: eligibility.startYmd?.slice(0, 10) ?? "",
        endYmd: eligibility.endYmd?.slice(0, 10) ?? "",
      });
    }
  }, [isEditing, eligibility, form]);

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      return apiRequest("POST", "/api/sitespecific/bao/immediate-eligibility", {
        employerId: employer.id,
        startYmd: data.startYmd,
        endYmd: data.endYmd,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/immediate-eligibility/employer", employer.id] });
      toast({
        title: "Immediate Eligibility Set",
        description: "The immediate eligibility window has been saved.",
      });
      setIsCreating(false);
      form.reset();
    },
    onError: (err: any) => {
      toast({
        title: "Save Failed",
        description: err?.message || "Failed to save immediate eligibility.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormValues }) => {
      return apiRequest("PATCH", `/api/sitespecific/bao/immediate-eligibility/${id}`, {
        startYmd: data.startYmd,
        endYmd: data.endYmd,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/immediate-eligibility/employer", employer.id] });
      toast({
        title: "Immediate Eligibility Updated",
        description: "The immediate eligibility window has been updated.",
      });
      setIsEditing(false);
    },
    onError: (err: any) => {
      toast({
        title: "Update Failed",
        description: err?.message || "Failed to update immediate eligibility.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sitespecific/bao/immediate-eligibility/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/immediate-eligibility/employer", employer.id] });
      toast({
        title: "Immediate Eligibility Cleared",
        description: "The immediate eligibility window has been removed.",
      });
      setDeleteDialogOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: "Clear Failed",
        description: err?.message || "Failed to clear immediate eligibility.",
        variant: "destructive",
      });
    },
  });

  const openCreateDialog = () => {
    form.reset({ startYmd: "", endYmd: "" });
    setIsCreating(true);
  };

  const onSubmit = (data: FormValues) => {
    if (isEditing && eligibility) {
      updateMutation.mutate({ id: eligibility.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-destructive">
          Failed to load immediate eligibility. The BAO module may not be enabled.
        </CardContent>
      </Card>
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle data-testid="title-immediate-eligibility">Immediate Eligibility</CardTitle>
              <CardDescription>
                Immediate eligibility window for {employer.name}
              </CardDescription>
            </div>
            {eligibility && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  data-testid="button-edit-immediate-eligibility"
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                  data-testid="button-delete-immediate-eligibility"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!eligibility ? (
            <div className="text-center py-8">
              <CalendarClock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">No immediate eligibility window configured for this employer.</p>
              <Button onClick={openCreateDialog} data-testid="button-add-immediate-eligibility">
                <Plus className="h-4 w-4 mr-2" />
                Set Immediate Eligibility
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="text-muted-foreground text-sm">Start Date</Label>
                <p className="font-medium" data-testid="text-start-ymd">{formatYmd(eligibility.startYmd)}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">End Date</Label>
                <p className="font-medium" data-testid="text-end-ymd">{formatYmd(eligibility.endYmd)}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Immediate Eligibility</DialogTitle>
            <DialogDescription>
              Are you sure you want to clear the immediate eligibility window for this employer? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => eligibility && deleteMutation.mutate(eligibility.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isEditing || isCreating}
        onOpenChange={(open) => {
          if (!open) {
            setIsEditing(false);
            setIsCreating(false);
            form.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Immediate Eligibility" : "Set Immediate Eligibility"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the immediate eligibility window for this employer."
                : "Configure the immediate eligibility window for this employer."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="startYmd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="input-start-ymd" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endYmd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="input-end-ymd" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setIsCreating(false);
                    form.reset();
                  }}
                  data-testid="button-cancel-save"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving} data-testid="button-save-immediate-eligibility">
                  {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function EmployerBaoImmediateEligibilityPage() {
  return (
    <EmployerLayout activeTab="sitespecific-bao-immediate-eligibility">
      <ImmediateEligibilityContent />
    </EmployerLayout>
  );
}
