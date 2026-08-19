import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useQuery } from "@tanstack/react-query";
import { PhoneNumber, ContactPostal } from "@shared/schema";
import { Phone, MapPin } from "lucide-react";

function EmployerContactViewContent() {
  const { employerContact } = useEmployerContactLayout();

  // Fetch primary phone number
  const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/contacts", employerContact.contactId, "phone-numbers"],
  });

  // Fetch primary address
  const { data: addresses = [] } = useQuery<ContactPostal[]>({
    queryKey: ["/api/contacts", employerContact.contactId, "addresses"],
  });

  const primaryPhone = phoneNumbers.find(p => p.isPrimary && p.isActive);
  const primaryAddress = addresses.find(a => a.isPrimary && a.isActive);

  const formatAddress = (address: ContactPostal) => {
    return `${address.street}, ${address.city}, ${address.state} ${address.postalCode}`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Name</div>
            <div className="text-base" data-testid="text-contact-display-name">
              {employerContact.contact.displayName}
            </div>
          </div>

          <Separator />

          {employerContact.contact.email && (
            <>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Email</div>
                <div className="text-base" data-testid="text-contact-email">
                  {employerContact.contact.email}
                </div>
              </div>
              <Separator />
            </>
          )}

          {primaryPhone && (
            <>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                  <Phone size={14} />
                  Primary Phone
                </div>
                <div className="text-base" data-testid="text-contact-primary-phone">
                  {primaryPhone.phoneNumber}
                  {primaryPhone.friendlyName && (
                    <span className="text-sm text-muted-foreground ml-2">
                      ({primaryPhone.friendlyName})
                    </span>
                  )}
                </div>
              </div>
              <Separator />
            </>
          )}

          {primaryAddress && (
            <>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                  <MapPin size={14} />
                  Primary Address
                </div>
                <div className="text-base" data-testid="text-contact-primary-address">
                  {primaryAddress.friendlyName && (
                    <div className="font-medium text-sm text-muted-foreground">
                      {primaryAddress.friendlyName}
                    </div>
                  )}
                  <div>{formatAddress(primaryAddress)}</div>
                </div>
              </div>
              <Separator />
            </>
          )}

          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Position</div>
            <div className="text-base" data-testid="text-contact-position">
              {employerContact.position || "None"}
            </div>
          </div>

          <Separator />

          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Contact Type</div>
            <div className="text-base" data-testid="text-contact-type">
              {employerContact.contactType ? employerContact.contactType.name : "None"}
            </div>
            {employerContact.contactType?.description && (
              <div className="text-sm text-muted-foreground mt-1">
                {employerContact.contactType.description}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmployerContactViewPage() {
  return (
    <EmployerContactLayout activeTab="view">
      <EmployerContactViewContent />
    </EmployerContactLayout>
  );
}
