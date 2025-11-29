import { useQuery } from "@tanstack/react-query";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { CommPostal } from "@/components/comm/CommPostal";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Address {
  id: string;
  contactId: string;
  friendlyName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  isPrimary: boolean;
  isActive: boolean;
}

function EmployerContactSendPostalContent() {
  const { employerContact } = useEmployerContactLayout();

  const { 
    data: addresses, 
    isLoading: isLoadingAddresses, 
    error: addressError 
  } = useQuery<Address[]>({
    queryKey: ["/api/contacts", employerContact.contactId, "addresses"],
    enabled: !!employerContact.contactId,
  });

  if (isLoadingAddresses) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Postal Mail
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (addressError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Postal Mail
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              Failed to load addresses. Please try again.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <CommPostal 
      contactId={employerContact.contactId} 
      addresses={addresses || []}
      contactName={employerContact.contact?.displayName}
    />
  );
}

export default function EmployerContactSendPostal() {
  return (
    <EmployerContactLayout activeTab="send-postal">
      <EmployerContactSendPostalContent />
    </EmployerContactLayout>
  );
}
