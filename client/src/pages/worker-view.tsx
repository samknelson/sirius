import { Mail, Phone, MapPin, Calendar, IdCard } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PostalAddress, PhoneNumber as PhoneNumberType, WorkerId, WorkerIdType } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";
import { GoogleMap } from "@/components/ui/google-map";
import { Badge } from "@/components/ui/badge";

function WorkerDetailsContent() {
  const { worker, contact } = useWorkerLayout();

  // Fetch primary address
  const { data: addresses = [] } = useQuery<PostalAddress[]>({
    queryKey: ["/api/contacts", worker.contactId, "addresses"],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${worker.contactId}/addresses`);
      if (!response.ok) {
        throw new Error("Failed to fetch addresses");
      }
      return response.json();
    },
  });

  // Fetch primary phone number
  const { data: phoneNumbers = [] } = useQuery<PhoneNumberType[]>({
    queryKey: ["/api/contacts", worker.contactId, "phone-numbers"],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${worker.contactId}/phone-numbers`);
      if (!response.ok) {
        throw new Error("Failed to fetch phone numbers");
      }
      return response.json();
    },
  });

  // Fetch worker IDs
  const { data: workerIds = [] } = useQuery<WorkerId[]>({
    queryKey: ["/api/workers", worker.id, "ids"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/ids`);
      if (!response.ok) {
        throw new Error("Failed to fetch worker IDs");
      }
      return response.json();
    },
  });

  // Fetch worker ID types
  const { data: workerIdTypes = [] } = useQuery<WorkerIdType[]>({
    queryKey: ["/api/worker-id-types"],
    queryFn: async () => {
      const response = await fetch("/api/worker-id-types");
      if (!response.ok) {
        throw new Error("Failed to fetch worker ID types");
      }
      return response.json();
    },
  });

  // Find primary address (prefer primary+active, then just primary, then just active)
  const primaryAddress = addresses.find(addr => addr.isPrimary && addr.isActive) 
    || addresses.find(addr => addr.isPrimary)
    || addresses.find(addr => addr.isActive);
  
  // Find primary phone (prefer primary+active, then just primary, then just active)
  const primaryPhone = phoneNumbers.find(phone => phone.isPrimary && phone.isActive)
    || phoneNumbers.find(phone => phone.isPrimary)
    || phoneNumbers.find(phone => phone.isActive);

  return (
    <Card>
      <CardContent className="space-y-6">
        {/* Identity */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Identity</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Full Name</label>
              <p className="text-foreground" data-testid={`text-worker-full-name-${worker.id}`}>
                {contact?.displayName || 'Loading...'}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Sirius ID / Record ID</label>
              <p className="text-foreground font-mono text-sm" data-testid={`text-worker-ids-${worker.id}`}>
                {worker.siriusId} / {worker.id}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Calendar size={14} />
                Birth Date
              </label>
              {contact?.birthDate ? (
                <p className="text-foreground" data-testid="text-worker-birthdate">
                  {(() => {
                    const [year, month, day] = contact.birthDate.split('-');
                    const monthNames = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"];
                    return `${monthNames[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
                  })()}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm" data-testid="text-no-birthdate">
                  No birth date set
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <IdCard size={14} />
                SSN
              </label>
              {worker.ssn ? (
                <p className="text-foreground font-mono" data-testid="text-worker-ssn">
                  {worker.ssn.replace(/(\d{3})(\d{2})(\d{4})/, '$1-$2-$3')}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm" data-testid="text-no-ssn">
                  No SSN set
                </p>
              )}
            </div>
            {workerIds.length > 0 && (
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <IdCard size={14} />
                  Additional IDs
                </label>
                <div className="flex flex-wrap gap-2">
                  {workerIds.map((workerId) => {
                    const type = workerIdTypes.find(t => t.id === workerId.typeId);
                    return (
                      <Badge key={workerId.id} variant="secondary" data-testid={`badge-worker-id-${workerId.id}`}>
                        <span className="font-medium">{type?.name || 'Unknown'}:</span>
                        <span className="ml-1 font-mono">{workerId.value}</span>
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
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
                <div className="space-y-4">
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
                  {primaryAddress.latitude !== null && primaryAddress.latitude !== undefined && 
                   primaryAddress.longitude !== null && primaryAddress.longitude !== undefined && (
                    <GoogleMap
                      latitude={primaryAddress.latitude}
                      longitude={primaryAddress.longitude}
                      height="400px"
                      zoom={16}
                      markerTitle={primaryAddress.friendlyName || "Primary Address"}
                    />
                  )}
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
  );
}

export default function WorkerView() {
  return (
    <WorkerLayout activeTab="details">
      <WorkerDetailsContent />
    </WorkerLayout>
  );
}
