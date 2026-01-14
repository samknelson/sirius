import { Mail, Phone, MapPin, Calendar, IdCard, Gift, Building2, Home, Briefcase, Users } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ContactPostal, PhoneNumber as PhoneNumberType, WorkerId, WorkerIdType, TrustWmb, TrustBenefit, Employer, WorkerWs, EmploymentStatus, BargainingUnit } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";
import { GoogleMap } from "@/components/ui/google-map";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";

interface CurrentEmploymentEntry {
  id: string;
  month: number;
  year: number;
  workerId: string;
  employerId: string;
  employmentStatusId: string;
  home: boolean;
  employer: Employer;
  employmentStatus: EmploymentStatus;
}

interface WorkerBenefit extends TrustWmb {
  benefit: TrustBenefit;
  employer: Employer;
}

function WorkerDetailsContent() {
  const { worker, contact } = useWorkerLayout();
  const { hasComponent } = useAuth();

  // Fetch bargaining unit if enabled
  const { data: bargainingUnit } = useQuery<BargainingUnit>({
    queryKey: ["/api/bargaining-units", worker.bargainingUnitId],
    enabled: hasComponent("bargainingunits") && !!worker.bargainingUnitId,
  });

  // Fetch primary address
  const { data: addresses = [] } = useQuery<ContactPostal[]>({
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
    queryKey: ["/api/options/worker-id-type"],
  });

  // Fetch worker benefits
  const { data: allBenefits = [], isLoading: isLoadingBenefits } = useQuery<WorkerBenefit[]>({
    queryKey: ["/api/workers", worker.id, "benefits"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/benefits`);
      if (!response.ok) {
        throw new Error("Failed to fetch worker benefits");
      }
      return response.json();
    },
  });

  // Fetch work statuses
  const { data: workStatuses = [] } = useQuery<WorkerWs[]>({
    queryKey: ["/api/options/worker-ws"],
  });

  // Fetch current employment
  const { data: currentEmployment = [], isLoading: isLoadingEmployment } = useQuery<CurrentEmploymentEntry[]>({
    queryKey: ["/api/workers", worker.id, "hours", "current"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/hours?view=current`);
      if (!response.ok) throw new Error("Failed to fetch current employment");
      return response.json();
    },
  });

  // Get current month and year
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // JavaScript months are 0-indexed
  const currentYear = now.getFullYear();

  // Filter benefits for current month/year
  const currentBenefits = allBenefits.filter(
    (benefit) => benefit.month === currentMonth && benefit.year === currentYear
  );

  // Find primary address (prefer primary+active, then just primary, then just active)
  const primaryAddress = addresses.find(addr => addr.isPrimary && addr.isActive) 
    || addresses.find(addr => addr.isPrimary)
    || addresses.find(addr => addr.isActive);
  
  // Find primary phone (prefer primary+active, then just primary, then just active)
  const primaryPhone = phoneNumbers.find(phone => phone.isPrimary && phone.isActive)
    || phoneNumbers.find(phone => phone.isPrimary)
    || phoneNumbers.find(phone => phone.isActive);

  // Find current work status
  const currentWorkStatus = worker.denormWsId 
    ? workStatuses.find(ws => ws.id === worker.denormWsId)
    : null;

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
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Briefcase size={14} />
                Work Status
              </label>
              {currentWorkStatus ? (
                <p className="text-foreground" data-testid="text-worker-work-status">
                  {currentWorkStatus.name}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm" data-testid="text-no-work-status">
                  No work status set
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Briefcase size={14} />
                Job Title
              </label>
              {worker.denormJobTitle ? (
                <p className="text-foreground" data-testid="text-worker-job-title">
                  {worker.denormJobTitle}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm" data-testid="text-no-job-title">
                  No job title set
                </p>
              )}
            </div>
            {hasComponent("bargainingunits") && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Users size={14} />
                  Bargaining Unit
                </label>
                {bargainingUnit ? (
                  <Link href={`/bargaining-units/${bargainingUnit.id}`}>
                    <p className="text-foreground hover:underline cursor-pointer" data-testid="text-worker-bargaining-unit">
                      {bargainingUnit.name}
                    </p>
                  </Link>
                ) : (
                  <p className="text-muted-foreground text-sm" data-testid="text-no-bargaining-unit">
                    No bargaining unit assigned
                  </p>
                )}
              </div>
            )}
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

        {/* Current Employment */}
        <div className="pt-4 border-t border-border">
          <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Building2 size={18} />
            Current Employment
          </h3>
          {isLoadingEmployment ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : currentEmployment.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-current-employment">
              No current employment records
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground mb-3">
                Current as of {new Date(currentYear, currentMonth - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </p>
              <div className="space-y-2">
                {currentEmployment.map((entry) => (
                  <div 
                    key={entry.id}
                    className="flex items-center justify-between p-3 rounded-md bg-muted/30"
                    data-testid={`current-employment-${entry.id}`}
                  >
                    <div className="flex items-center gap-3">
                      {entry.employer ? (
                        <Link href={`/employers/${entry.employer.id}`}>
                          <span className="font-medium text-foreground hover:underline cursor-pointer">
                            {entry.employer.name}
                          </span>
                        </Link>
                      ) : (
                        <span className="font-medium text-muted-foreground">
                          Unknown Employer
                        </span>
                      )}
                      {entry.employmentStatus && (
                        <Badge 
                          variant={entry.employmentStatus.employed ? "default" : "secondary"}
                          data-testid={`badge-employment-status-${entry.id}`}
                        >
                          {entry.employmentStatus.name}
                        </Badge>
                      )}
                      {entry.home && (
                        <Badge variant="default" data-testid={`badge-home-employer-${entry.id}`}>
                          <Home size={12} className="mr-1" />
                          Home
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Current Benefits */}
        <div className="pt-4 border-t border-border">
          <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Gift size={18} />
            Current Benefits
          </h3>
          {isLoadingBenefits ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : currentBenefits.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-current-benefits">
              No current benefit records
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground mb-3">
                Benefits received this month ({new Date(currentYear, currentMonth - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })})
              </p>
              <div className="space-y-2">
                {currentBenefits.map((benefit) => (
                  <div 
                    key={benefit.id}
                    className="flex items-center justify-between p-3 rounded-md bg-muted/30"
                    data-testid={`current-benefit-${benefit.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Gift size={16} className="text-muted-foreground" />
                      {benefit.benefit ? (
                        <span className="font-medium text-foreground">
                          {benefit.benefit.name}
                        </span>
                      ) : (
                        <span className="font-medium text-muted-foreground">
                          Unknown Benefit
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground">-</span>
                      {benefit.employer ? (
                        <Link href={`/employers/${benefit.employer.id}`}>
                          <span className="text-sm text-foreground hover:underline cursor-pointer">
                            {benefit.employer.name}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Unknown Employer
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                  {/* Map temporarily hidden - will be used later
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
                  */}
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
