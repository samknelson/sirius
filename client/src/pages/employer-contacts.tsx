import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
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
import { useAccessCheck } from "@/hooks/use-access-check";
import type { EmployerContactType, PhoneNumber, ContactPostal } from "@shared/schema";
import { generateDisplayName } from "@shared/schema";

interface EmployerContactResponse {
  id: string;
  employerId: string;
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

interface ContactWithDetails extends EmployerContactResponse {
  primaryPhone?: PhoneNumber;
  primaryAddress?: ContactPostal;
  hasUser?: boolean;
}

function EmployerContactsContent() {
  const { employer } = useEmployerLayout();
  const { toast } = useToast();
  const [isAddingContact, setIsAddingContact] = useState(false);

  const { canAccess: canManage } = useAccessCheck('employer.manage', employer.id);

  const { data: contacts, isLoading: contactsLoading } = useQuery<EmployerContactResponse[]>({
    queryKey: ["/api/employers", employer.id, "contacts"],
  });

  const { data: contactTypes } = useQuery<EmployerContactType[]>({
    queryKey: ["/api/options/employer-contact-type"],
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

  // Fetch user status for all employer contacts in batch
  const employerContactIds = contacts?.map(c => c.id) || [];
  const userStatusQueries = useQuery({
    queryKey: ["/api/employer-contacts", "user-status", employerContactIds],
    queryFn: async () => {
      const response = await fetch("/api/employer-contacts/user-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ employerContactIds }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch user statuses");
      }
      
      const data = await response.json();
      return data.statuses as Array<{ employerContactId: string; userId: string | null; hasUser: boolean; accountStatus: string | null }>;
    },
    enabled: employerContactIds.length > 0,
  });

  // Combine contacts with their phone, address, and user status data
  const contactsWithDetails: ContactWithDetails[] = contacts?.map(contact => {
    const phoneData = phoneQueries.data?.find(p => p.contactId === contact.contactId);
    const addressData = addressQueries.data?.find(a => a.contactId === contact.contactId);
    const userStatusData = userStatusQueries.data?.find(u => u.employerContactId === contact.id);
    
    const primaryPhone = phoneData?.phones?.find((p: PhoneNumber) => p.isPrimary && p.isActive);
    const primaryAddress = addressData?.addresses?.find((a: ContactPostal) => a.isPrimary && a.isActive);

    return {
      ...contact,
      primaryPhone,
      primaryAddress,
      hasUser: userStatusData?.hasUser || false,
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
      contactTypeId: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateContactFormData & { displayName: string }) => {
      return await apiRequest("POST", `/api/employers/${employer.id}/contacts`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employer.id, "contacts"] });
      toast({
        title: "Success",
        description: "Employer contact created successfully",
      });
      form.reset();
      setIsAddingContact(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create employer contact",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/employer-contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employer.id, "contacts"] });
      toast({
        title: "Success",
        description: "Employer contact deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete employer contact",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateContactFormData) => {
    // Generate display name from name components
    const displayName = generateDisplayName({
      title: data.title || null,
      given: data.given || null,
      middle: data.middle || null,
      family: data.family || null,
      generational: data.generational || null,
      credentials: data.credentials || null,
    });
    
    // Add display name to the data before submitting
    createMutation.mutate({ ...data, displayName });
  };

  if (contactsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Contacts</CardTitle>
          {!isAddingContact && canManage && (
            <Button
              onClick={() => setIsAddingContact(true)}
              size="sm"
              data-testid="button-add-contact"
            >
              <Plus size={16} className="mr-2" />
              Add Contact
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isAddingContact && (
            <div className="mb-6 p-4 border border-border rounded-lg bg-muted/20">
              <h3 className="text-lg font-semibold mb-4">Add New Contact</h3>
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
                            <Input type="email" {...field} data-testid="input-email" />
                          </FormControl>
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
                            <Input {...field} data-testid="input-title" />
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
                            <Input {...field} data-testid="input-given" />
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
                            <Input {...field} data-testid="input-middle" />
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
                            <Input {...field} data-testid="input-family" />
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
                          <FormLabel>Generational</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-generational" />
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
                            <Input {...field} data-testid="input-credentials" />
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
                          <FormLabel>Contact Type (Optional)</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      type="submit"
                      disabled={createMutation.isPending}
                      data-testid="button-submit-contact"
                    >
                      {createMutation.isPending ? "Creating..." : "Create Contact"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsAddingContact(false);
                        form.reset();
                      }}
                      disabled={createMutation.isPending}
                      data-testid="button-cancel-contact"
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          )}

          {contactsWithDetails && contactsWithDetails.length > 0 ? (
            <div className="space-y-4">
              {contactsWithDetails.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-start justify-between p-4 border border-border rounded-lg"
                  data-testid={`card-contact-${contact.id}`}
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-foreground" data-testid={`text-contact-name-${contact.id}`}>
                        {contact.contact.displayName}
                      </div>
                      {contact.hasUser && (
                        <Badge variant="secondary" className="flex items-center gap-1" data-testid={`badge-user-account-${contact.id}`}>
                          <User size={12} />
                          User Account
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground" data-testid={`text-contact-email-${contact.id}`}>
                      {contact.contact.email}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm">
                      {contact.contactType && (
                        <div className="text-muted-foreground" data-testid={`text-contact-type-${contact.id}`}>
                          <span className="font-medium">Type:</span> {contact.contactType.name}
                        </div>
                      )}
                      {contact.primaryPhone && (
                        <div className="flex items-center gap-1 text-muted-foreground" data-testid={`text-contact-phone-${contact.id}`}>
                          <Phone size={14} />
                          {contact.primaryPhone.phoneNumber}
                        </div>
                      )}
                      {contact.primaryAddress && (
                        <div className="flex items-center gap-1 text-muted-foreground" data-testid={`text-contact-address-${contact.id}`}>
                          <MapPin size={14} />
                          {contact.primaryAddress.city}, {contact.primaryAddress.state}
                        </div>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2">
                      <Link href={`/employer-contacts/${contact.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`button-view-contact-${contact.id}`}
                        >
                          <Eye size={16} />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(contact.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-contact-${contact.id}`}
                      >
                        <Trash2 size={16} className="text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No contacts found for this employer.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmployerContactsPage() {
  return (
    <EmployerLayout activeTab="contacts">
      <EmployerContactsContent />
    </EmployerLayout>
  );
}
