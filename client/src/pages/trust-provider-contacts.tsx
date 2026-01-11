import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Eye, Phone, MapPin, User } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { TrustProviderType, PhoneNumber, ContactPostal } from "@shared/schema";
import { generateDisplayName } from "@shared/schema";

interface TrustProviderContactResponse {
  id: string;
  providerId: string;
  contactId: string;
  contactTypeId: string | null;
  contact: {
    id: string;
    title: string | null;
    given: string | null;
    middle: string | null;
    family: string | null;
    generational: string | null;
    credentials: string | null;
    displayName: string;
    email: string | null;
    birthDate: string | null;
    gender: string | null;
    genderNota: string | null;
    genderCalc: string | null;
  };
  contactType?: {
    id: string;
    name: string;
    description: string | null;
  } | null;
}

const createContactSchema = z.object({
  email: z.string().email("Valid email is required"),
  title: z.string().optional(),
  given: z.string().optional(),
  middle: z.string().optional(),
  family: z.string().optional(),
  generational: z.string().optional(),
  credentials: z.string().optional(),
  contactTypeId: z.string().optional(),
});

type CreateContactFormData = z.infer<typeof createContactSchema>;

interface ContactWithDetails extends TrustProviderContactResponse {
  primaryPhone?: PhoneNumber;
  primaryAddress?: ContactPostal;
}

function TrustProviderContactsContent() {
  const { provider, isLoading: providerLoading } = useTrustProviderLayout();
  const { toast } = useToast();
  const [isAddingContact, setIsAddingContact] = useState(false);

  const { data: contacts, isLoading: contactsLoading } = useQuery<TrustProviderContactResponse[]>({
    queryKey: ["/api/trust-providers", provider?.id, "contacts"],
    enabled: !!provider,
  });

  const { data: contactTypes } = useQuery<TrustProviderType[]>({
    queryKey: ["/api/options/trust-provider-type"],
  });

  // Fetch phone numbers and addresses for all contacts
  const contactIds = contacts?.map(c => c.contactId) || [];
  const phoneQueries = useQuery({
    queryKey: ["/api/contacts", "phones", contactIds],
    queryFn: async () => {
      const results = await Promise.all(
        contactIds.map(async (contactId) => {
          const response = await fetch(`/api/contacts/${contactId}/phone-numbers`);
          if (!response.ok) return { contactId, phones: [] };
          const phones = await response.json();
          return { contactId, phones };
        })
      );
      return results;
    },
    enabled: contactIds.length > 0,
  });

  const addressQueries = useQuery({
    queryKey: ["/api/contacts", "addresses", contactIds],
    queryFn: async () => {
      const results = await Promise.all(
        contactIds.map(async (contactId) => {
          const response = await fetch(`/api/contacts/${contactId}/addresses`);
          if (!response.ok) return { contactId, addresses: [] };
          const addresses = await response.json();
          return { contactId, addresses };
        })
      );
      return results;
    },
    enabled: contactIds.length > 0,
  });

  // Combine contacts with their phone and address data
  const contactsWithDetails: ContactWithDetails[] = contacts?.map(contact => {
    const phoneData = phoneQueries.data?.find(p => p.contactId === contact.contactId);
    const addressData = addressQueries.data?.find(a => a.contactId === contact.contactId);
    
    const primaryPhone = phoneData?.phones?.find((p: PhoneNumber) => p.isPrimary && p.isActive);
    const primaryAddress = addressData?.addresses?.find((a: ContactPostal) => a.isPrimary && a.isActive);

    return {
      ...contact,
      primaryPhone,
      primaryAddress,
    };
  }) || [];

  const form = useForm<CreateContactFormData>({
    resolver: zodResolver(createContactSchema),
    defaultValues: {
      email: "",
      title: "",
      given: "",
      middle: "",
      family: "",
      generational: "",
      credentials: "",
      contactTypeId: undefined,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateContactFormData & { displayName: string }) => {
      if (!provider) throw new Error("Provider not found");
      return await apiRequest("POST", `/api/trust-providers/${provider.id}/contacts`, data);
    },
    onSuccess: () => {
      if (!provider) return;
      queryClient.invalidateQueries({ queryKey: ["/api/trust-providers", provider.id, "contacts"] });
      toast({
        title: "Contact created",
        description: "Provider contact has been created successfully",
      });
      form.reset();
      setIsAddingContact(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create provider contact",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (contactId: string) => {
      return await apiRequest("DELETE", `/api/trust-provider-contacts/${contactId}`);
    },
    onSuccess: () => {
      if (!provider) return;
      queryClient.invalidateQueries({ queryKey: ["/api/trust-providers", provider.id, "contacts"] });
      toast({
        title: "Contact deleted",
        description: "Provider contact has been deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete provider contact",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: CreateContactFormData) => {
    if (!provider) return;
    
    const displayName = generateDisplayName({
      title: data.title || null,
      given: data.given || null,
      middle: data.middle || null,
      family: data.family || null,
      generational: data.generational || null,
      credentials: data.credentials || null,
    });

    createMutation.mutate({
      ...data,
      displayName,
    });
  };

  const handleDelete = (contactId: string) => {
    if (confirm("Are you sure you want to delete this contact?")) {
      deleteMutation.mutate(contactId);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Provider Contacts</CardTitle>
          <Button
            size="sm"
            onClick={() => setIsAddingContact(!isAddingContact)}
            data-testid="button-add-contact"
          >
            <Plus size={16} className="mr-2" />
            {isAddingContact ? "Cancel" : "Add Contact"}
          </Button>
        </CardHeader>
        <CardContent>
          {isAddingContact && (
            <Card className="mb-6 bg-muted/50">
              <CardHeader>
                <CardTitle className="text-lg">Add New Contact</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="email"
                                placeholder="contact@example.com"
                                data-testid="input-contact-email"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="contactTypeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contact Type</FormLabel>
                            <Select
                              onValueChange={(value) => field.onChange(value || undefined)}
                              value={field.value || undefined}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-contact-type">
                                  <SelectValue placeholder="Select contact type (optional)" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
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

                      <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Title</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Dr., Mr., Ms., etc."
                                data-testid="input-contact-title"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="given"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Given Name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="John"
                                data-testid="input-contact-given"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="middle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Middle Name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Middle"
                                data-testid="input-contact-middle"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="family"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Family Name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Doe"
                                data-testid="input-contact-family"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="generational"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Generational Suffix</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Jr., Sr., III, etc."
                                data-testid="input-contact-generational"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="credentials"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Credentials</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="PhD, MD, etc."
                                data-testid="input-contact-credentials"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex justify-end space-x-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          form.reset();
                          setIsAddingContact(false);
                        }}
                        data-testid="button-cancel-add-contact"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createMutation.isPending}
                        data-testid="button-submit-contact"
                      >
                        {createMutation.isPending ? "Creating..." : "Create Contact"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          {contactsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="border rounded-lg p-4">
                  <Skeleton className="h-6 w-48 mb-2" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ))}
            </div>
          ) : contactsWithDetails.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <User size={48} className="mx-auto mb-4 opacity-50" />
              <p>No contacts found for this provider.</p>
              <p className="text-sm mt-2">Click "Add Contact" to create one.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {contactsWithDetails.map((contact) => (
                <Card key={contact.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-lg" data-testid={`text-contact-name-${contact.id}`}>
                            {contact.contact.displayName}
                          </h3>
                          {contact.contactType && (
                            <Badge variant="secondary" data-testid={`badge-contact-type-${contact.id}`}>
                              {contact.contactType.name}
                            </Badge>
                          )}
                        </div>

                        <div className="space-y-2 text-sm text-muted-foreground">
                          {contact.contact.email && (
                            <div className="flex items-center gap-2">
                              <User size={14} />
                              <span data-testid={`text-contact-email-${contact.id}`}>
                                {contact.contact.email}
                              </span>
                            </div>
                          )}

                          {contact.primaryPhone && (
                            <div className="flex items-center gap-2">
                              <Phone size={14} />
                              <span data-testid={`text-contact-phone-${contact.id}`}>
                                {contact.primaryPhone.phoneNumber}
                                {contact.primaryPhone.friendlyName && ` (${contact.primaryPhone.friendlyName})`}
                              </span>
                            </div>
                          )}

                          {contact.primaryAddress && (
                            <div className="flex items-center gap-2">
                              <MapPin size={14} />
                              <span data-testid={`text-contact-address-${contact.id}`}>
                                {contact.primaryAddress.street}, {contact.primaryAddress.city}, {contact.primaryAddress.state} {contact.primaryAddress.postalCode}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link href={`/trust-provider-contacts/${contact.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-view-contact-${contact.id}`}
                          >
                            <Eye size={16} className="mr-2" />
                            View
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(contact.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-contact-${contact.id}`}
                        >
                          <Trash2 size={16} className="text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TrustProviderContactsPage() {
  return (
    <TrustProviderLayout activeTab="contacts">
      <TrustProviderContactsContent />
    </TrustProviderLayout>
  );
}
