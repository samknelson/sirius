import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { EmployerContactType } from "@shared/schema";

const updateContactTypeSchema = z.object({
  contactTypeId: z.string().nullable(),
});

type UpdateContactTypeFormData = z.infer<typeof updateContactTypeSchema>;

function EmployerContactEditContent() {
  const { employerContact } = useEmployerContactLayout();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: contactTypes } = useQuery<EmployerContactType[]>({
    queryKey: ["/api/employer-contact-types"],
  });

  const form = useForm<UpdateContactTypeFormData>({
    resolver: zodResolver(updateContactTypeSchema),
    defaultValues: {
      contactTypeId: null,
    },
  });

  // Update form when data loads
  useEffect(() => {
    if (employerContact) {
      form.reset({
        contactTypeId: employerContact.contactTypeId || null,
      });
    }
  }, [employerContact, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateContactTypeFormData) => {
      // Normalize "null" string to actual null
      const normalizedData = {
        contactTypeId: data.contactTypeId === "null" ? null : data.contactTypeId,
      };
      return await apiRequest("PATCH", `/api/employer-contacts/${employerContact.id}`, normalizedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employer-contacts", employerContact.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employerContact.employerId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employerContact.employerId] });
      toast({
        title: "Success",
        description: "Contact type updated successfully",
      });
      navigate(`/employer-contacts/${employerContact.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update contact type",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: UpdateContactTypeFormData) => {
    updateMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Edit Contact Type</CardTitle>
          <CardDescription>
            Update the contact type for {employerContact.contact.displayName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-4 bg-muted/30 rounded-lg">
            <div className="text-sm font-medium mb-1">Contact Information</div>
            <div className="text-sm text-muted-foreground">
              <div>Name: {employerContact.contact.displayName}</div>
              {employerContact.contact.email && (
                <div>Email: {employerContact.contact.email}</div>
              )}
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="contactTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Type</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value || undefined}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-contact-type">
                          <SelectValue placeholder="Select contact type (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="null">None</SelectItem>
                        {contactTypes?.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex items-center space-x-2">
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  data-testid="button-save"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(`/employer-contacts/${employerContact.id}`)}
                  disabled={updateMutation.isPending}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmployerContactEditPage() {
  return (
    <EmployerContactLayout activeTab="edit">
      <EmployerContactEditContent />
    </EmployerContactLayout>
  );
}
