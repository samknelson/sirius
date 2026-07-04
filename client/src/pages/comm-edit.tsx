import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CommLayout } from "@/components/layouts/CommLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { CommTagPicker } from "@/components/comm/CommTagPicker";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CommWithDetails } from "@/lib/comm-types";
import { Save } from "lucide-react";
import { COMM_STATUSES, COMM_STATUS_LABELS, type CommStatus } from "@shared/commStatus";

const formSchema = z.object({
  status: z.string(),
  tagIds: z.array(z.string()),
});

type FormValues = z.infer<typeof formSchema>;

export default function CommEdit() {
  const { commId } = useParams<{ commId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [didInit, setDidInit] = useState(false);

  const { data: comm, isLoading } = useQuery<CommWithDetails>({
    queryKey: ["/api/comm", commId],
    enabled: !!commId,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      status: "queued",
      tagIds: [],
    },
  });

  useEffect(() => {
    if (!didInit && comm) {
      form.reset({
        status: comm.status as CommStatus,
        tagIds: comm.tags?.map((t) => t.id) ?? [],
      });
      setDidInit(true);
    }
  }, [comm, didInit, form]);

  const currentStatusUnknown =
    !!comm && !COMM_STATUSES.includes(comm.status as CommStatus);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const body: { status?: string; tagIds: string[] } = {
        tagIds: values.tagIds,
      };
      const isValidStatus = (COMM_STATUSES as readonly string[]).includes(values.status);
      if (isValidStatus && values.status !== comm?.status) {
        body.status = values.status;
      }
      return await apiRequest("PUT", `/api/comm/${commId}`, body);
    },
    onSuccess: () => {
      toast({
        title: "Communication updated",
        description: "Status and tags saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/comm", commId] });
      if (comm?.contactId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/contacts", comm.contactId, "comm"],
        });
      }
      navigate(`/comm/${commId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update communication",
        description: error?.message ?? "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  const medium = (comm?.medium ?? "sms") as
    | "sms"
    | "email"
    | "postal"
    | "inapp";

  return (
    <CommLayout activeTab="edit">
      <Card>
        <CardHeader>
          <CardTitle>Edit Communication</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !comm ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading communication...
            </div>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
                data-testid="form-edit-comm"
              >
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-comm-status">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {COMM_STATUSES.map((value) => (
                            <SelectItem
                              key={value}
                              value={value}
                              data-testid={`select-status-option-${value}`}
                            >
                              {COMM_STATUS_LABELS[value]}
                            </SelectItem>
                          ))}
                          {currentStatusUnknown && comm && (
                            <SelectItem
                              value={comm.status}
                              data-testid={`select-status-option-${comm.status}`}
                            >
                              {comm.status} (current)
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tagIds"
                  render={({ field }) => (
                    <FormItem>
                      <CommTagPicker
                        medium={medium}
                        value={field.value}
                        onChange={field.onChange}
                        disabled={mutation.isPending}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    disabled={mutation.isPending}
                    data-testid="button-save-comm"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {mutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(`/comm/${commId}`)}
                    disabled={mutation.isPending}
                    data-testid="button-cancel-edit"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </CommLayout>
  );
}
