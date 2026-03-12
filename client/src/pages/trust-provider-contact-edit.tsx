import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { TrustProviderType } from "@shared/schema";

const updateContactTypeSchema = z.object({
  contactTypeId: z.string().nullable(),
});

type UpdateContactTypeFormData = z.infer<typeof updateContactTypeSchema>;

function TrustProviderContactEditContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: contactTypes } = useQuery<TrustProviderType[]>({
    queryKey: ["/api/options/trust-provider-type"],
  });

  const form = useForm<UpdateContactTypeFormData>({
    resolver: zodResolver(updateContactTypeSchema),
    defaultValues: {
      contactTypeId: null,
    },
  });

  // Update form when data loads
  useEffect(() => {
    if (trustProviderContact) {
      form.reset({
        contactTypeId: trustProviderContact.contactTypeId || null,
      });
    }
  }, [trustProviderContact, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateContactTypeFormData) => {
      // Normalize "null" string to actual null
      const normalizedData = {
        contactTypeId: data.contactTypeId === "null" ? null : data.contactTypeId,
      };
      return await apiRequest("PATCH", `/api/trust-provider-contacts/${trustProviderContact.id}`, normalizedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-contacts", trustProviderContact.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-providers", trustProviderContact.providerId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-providers", trustProviderContact.providerId] });
      toast({
        title: "Success",
        description: "Contact type updated successfully",
      });
      navigate(`/trust-provider-contacts/${trustProviderContact.id}`);
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
            Update the contact type for {trustProviderContact.contact.displayName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-4 bg-muted/30 rounded-lg">
            <div className="text-sm font-medium mb-1">Contact Information</div>
            <div className="text-sm text-muted-foreground">
              <div>Name: {trustProviderContact.contact.displayName}</div>
              {trustProviderContact.contact.email && (
                <div>Email: {trustProviderContact.contact.email}</div>
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
                  onClick={() => navigate(`/trust-provider-contacts/${trustProviderContact.id}`)}
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

export default function TrustProviderContactEditPage() {
  return (
    <TrustProviderContactLayout activeTab="edit">
      <TrustProviderContactEditContent />
    </TrustProviderContactLayout>
  );
}
