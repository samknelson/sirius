import { useQuery } from "@tanstack/react-query";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { CommSms } from "@/components/comm/CommSms";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, MessageSquare } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface PhoneNumber {
  id: string;
  contactId: string;
  friendlyName: string | null;
  phoneNumber: string;
  isPrimary: boolean;
  isActive: boolean;
}

function TrustProviderContactSendSmsContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  const { 
    data: phoneNumbers, 
    isLoading: isLoadingPhones, 
    error: phoneError 
  } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/contacts", trustProviderContact.contactId, "phone-numbers"],
    enabled: !!trustProviderContact.contactId,
  });

  if (isLoadingPhones) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Send SMS
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

  if (phoneError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Send SMS
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              Failed to load phone numbers. Please try again.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <CommSms 
      contactId={trustProviderContact.contactId} 
      phoneNumbers={phoneNumbers || []} 
    />
  );
}

export default function TrustProviderContactSendSms() {
  return (
    <TrustProviderContactLayout activeTab="send-sms">
      <TrustProviderContactSendSmsContent />
    </TrustProviderContactLayout>
  );
}
