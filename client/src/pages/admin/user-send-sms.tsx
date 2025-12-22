import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { CommSms } from "@/components/comm/CommSms";
import { useQuery } from "@tanstack/react-query";
import { PhoneNumber } from "@shared/schema";
import { MessageSquare, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

function UserSendSmsContent() {
  const { contact } = useUserLayout();

  const { 
    data: phoneNumbers, 
    isLoading: isLoadingPhones, 
    error: phoneError 
  } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/contacts", contact?.id, "phone-numbers"],
    enabled: !!contact?.id,
  });

  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Send SMS
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Contact Record</AlertTitle>
            <AlertDescription>
              No contact record found for this user. Sending SMS requires a contact record.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

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
      contactId={contact.id} 
      phoneNumbers={phoneNumbers || []} 
    />
  );
}

export default function UserSendSms() {
  return (
    <UserLayout activeTab="send-sms">
      <UserSendSmsContent />
    </UserLayout>
  );
}
