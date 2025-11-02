import { Star, User, ArrowLeft, Mail, Phone, Edit, MapPin } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Worker, PostalAddress, PhoneNumber as PhoneNumberType, Contact } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EditWorkerNameModal } from "@/components/workers/edit-worker-name-modal";
import { useState } from "react";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";

export default function WorkerView() {
  const { id } = useParams<{ id: string }>();
  const [editModalOpen, setEditModalOpen] = useState(false);
  
  const { data: worker, isLoading, error } = useQuery<Worker>({
    queryKey: ["/api/workers", id],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${id}`);
      if (!response.ok) {
        throw new Error("Worker not found");
      }
      return response.json();
    },
  });

  // Fetch contact for the worker
  const { data: contact } = useQuery<Contact>({
    queryKey: ["/api/contacts", worker?.contactId],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${worker?.contactId}`);
      if (!response.ok) {
        throw new Error("Contact not found");
      }
      return response.json();
    },
    enabled: !!worker?.contactId,
  });

  // Fetch primary address
  const { data: addresses = [] } = useQuery<PostalAddress[]>({
    queryKey: ["/api/contacts", worker?.contactId, "addresses"],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${worker?.contactId}/addresses`);
      if (!response.ok) {
        throw new Error("Failed to fetch addresses");
      }
      return response.json();
    },
    enabled: !!worker?.contactId,
  });

  // Fetch primary phone number
  const { data: phoneNumbers = [] } = useQuery<PhoneNumberType[]>({
    queryKey: ["/api/contacts", worker?.contactId, "phone-numbers"],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${worker?.contactId}/phone-numbers`);
      if (!response.ok) {
        throw new Error("Failed to fetch phone numbers");
      }
      return response.json();
    },
    enabled: !!worker?.contactId,
  });

  const primaryAddress = addresses.find(addr => addr.isPrimary && addr.isActive);
  const primaryPhone = phoneNumbers.find(phone => phone.isPrimary && phone.isActive);


  if (isLoading) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Star className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Worker Details</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/workers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-workers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Workers
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-48" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-6 w-32" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-40" />
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (error || !worker) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Star className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Worker Details</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/workers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-workers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Workers
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <User className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Worker Not Found</h3>
              <p className="text-muted-foreground text-center">
                The worker you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/workers">
                <Button className="mt-4" data-testid="button-return-to-workers">
                  Return to Workers
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Generate avatar background color based on worker ID
  const avatarColors = [
    "bg-primary/10 text-primary",
    "bg-accent/10 text-accent", 
    "bg-yellow-100 text-yellow-600",
    "bg-purple-100 text-purple-600",
    "bg-red-100 text-red-600",
  ];
  const avatarColor = avatarColors[worker.id.length % avatarColors.length];

  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Star className="text-primary-foreground" size={16} />
              </div>
              <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
              <span className="text-muted-foreground text-sm font-medium">Worker Details</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/workers">
                <Button variant="ghost" size="sm" data-testid="button-back-to-workers">
                  <ArrowLeft size={16} className="mr-2" />
                  Back to Workers
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center ${avatarColor}`}>
                  <User size={24} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <CardTitle className="text-2xl font-bold text-foreground" data-testid={`text-worker-name-${worker.id}`}>
                      {contact?.displayName || 'Loading...'}
                    </CardTitle>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setEditModalOpen(true)}
                      data-testid={`button-edit-name-${worker.id}`}
                    >
                      <Edit size={16} />
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-sm mt-1" data-testid={`text-worker-id-${worker.id}`}>
                    ID: {worker.id}
                  </p>
                </div>
              </div>
              
              {/* Navigation Links */}
              <div className="flex items-center space-x-2">
                <Button variant="default" size="sm" data-testid="button-worker-details">
                  Details
                </Button>
                <Link href={`/workers/${worker.id}/name`}>
                  <Button variant="outline" size="sm" data-testid="button-worker-name">
                    Name
                  </Button>
                </Link>
                <Link href={`/workers/${worker.id}/email`}>
                  <Button variant="outline" size="sm" data-testid="button-worker-email">
                    Email
                  </Button>
                </Link>
                <Link href={`/workers/${worker.id}/ids`}>
                  <Button variant="outline" size="sm" data-testid="button-worker-ids">
                    IDs
                  </Button>
                </Link>
                <Link href={`/workers/${worker.id}/addresses`}>
                  <Button variant="outline" size="sm" data-testid="button-worker-addresses">
                    Addresses
                  </Button>
                </Link>
                <Link href={`/workers/${worker.id}/phone-numbers`}>
                  <Button variant="outline" size="sm" data-testid="button-worker-phone-numbers">
                    Phone Numbers
                  </Button>
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Basic Information */}
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Basic Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Full Name</label>
                  <p className="text-foreground" data-testid={`text-worker-full-name-${worker.id}`}>
                    {contact?.displayName || 'Loading...'}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Worker ID</label>
                  <p className="text-foreground font-mono text-sm" data-testid={`text-worker-uuid-${worker.id}`}>
                    {worker.id}
                  </p>
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div className="pt-4 border-t border-border">
              <h3 className="text-lg font-semibold text-foreground mb-3">Contact Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Email Address */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Mail size={14} />
                    Email Address
                  </label>
                  {contact?.email ? (
                    <p className="text-foreground" data-testid="text-worker-email">
                      {contact.email}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-email">
                      No email address set
                    </p>
                  )}
                </div>

                {/* Primary Phone Number */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Phone size={14} />
                    Primary Phone Number
                  </label>
                  {primaryPhone ? (
                    <div className="text-foreground" data-testid="text-primary-phone">
                      {primaryPhone.friendlyName && (
                        <p className="font-medium text-sm text-muted-foreground mb-1">
                          {primaryPhone.friendlyName}
                        </p>
                      )}
                      <p className="text-lg">{formatPhoneNumberForDisplay(primaryPhone.phoneNumber)}</p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-primary-phone">
                      No primary phone number set
                    </p>
                  )}
                </div>

                {/* Primary Address */}
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <MapPin size={14} />
                    Primary Address
                  </label>
                  {primaryAddress ? (
                    <div className="text-foreground" data-testid="text-primary-address">
                      {primaryAddress.friendlyName && (
                        <p className="font-medium text-sm text-muted-foreground mb-1">
                          {primaryAddress.friendlyName}
                        </p>
                      )}
                      <p>{primaryAddress.street}</p>
                      <p>{primaryAddress.city}, {primaryAddress.state} {primaryAddress.postalCode}</p>
                      <p className="text-sm text-muted-foreground">{primaryAddress.country}</p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-primary-address">
                      No primary address set
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center space-x-3">
                <Link href="/workers">
                  <Button variant="outline" data-testid="button-back-to-list">
                    Back to List
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      <EditWorkerNameModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        worker={worker}
        contactName={contact?.displayName || ''}
      />
    </div>
  );
}