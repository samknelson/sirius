import { useQuery } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
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

function WorkerSendSmsContent() {
  const { worker, contact } = useWorkerLayout();

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
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Contact Not Found</AlertTitle>
            <AlertDescription>
              Unable to load contact information for this worker.
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

export default function WorkerSendSms() {
  return (
    <WorkerLayout activeTab="send-sms">
      <WorkerSendSmsContent />
    </WorkerLayout>
  );
}
