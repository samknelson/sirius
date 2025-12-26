import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Mail, MessageSquare, Bell } from "lucide-react";
import { CommEmail } from "./CommEmail";
import { CommSms } from "./CommSms";
import { CommPostal } from "./CommPostal";
import { CommInApp } from "./CommInApp";
import { PhoneNumber, Address } from "@/lib/entity-types";
import type { LucideIcon } from "lucide-react";

export type CommChannel = "email" | "sms" | "postal" | "inapp";

interface ChannelConfig {
  icon: LucideIcon;
  title: string;
  errorTitle: string;
  errorDescription: string;
}

const channelConfigs: Record<CommChannel, ChannelConfig> = {
  email: {
    icon: Mail,
    title: "Send Email",
    errorTitle: "Contact Not Found",
    errorDescription: "Unable to load contact information.",
  },
  sms: {
    icon: MessageSquare,
    title: "Send SMS",
    errorTitle: "Contact Not Found",
    errorDescription: "Unable to load contact information.",
  },
  postal: {
    icon: Mail,
    title: "Send Postal Mail",
    errorTitle: "Contact Not Found",
    errorDescription: "Unable to load contact information.",
  },
  inapp: {
    icon: Bell,
    title: "Send In-App Message",
    errorTitle: "Contact Not Found",
    errorDescription: "Unable to load contact information.",
  },
};

interface ContactData {
  id: string;
  email?: string | null;
  displayName?: string;
}

interface CommSendWrapperProps {
  channel: CommChannel;
  contact: ContactData | null | undefined;
  customErrorDescription?: string;
}

export function CommSendWrapper({ 
  channel, 
  contact, 
  customErrorDescription 
}: CommSendWrapperProps) {
  const config = channelConfigs[channel];
  const Icon = config.icon;

  const needsPhoneNumbers = channel === "sms";
  const needsAddresses = channel === "postal";

  const { 
    data: phoneNumbers, 
    isLoading: isLoadingPhones, 
    error: phoneError 
  } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/contacts", contact?.id, "phone-numbers"],
    enabled: needsPhoneNumbers && !!contact?.id,
  });

  const { 
    data: addresses, 
    isLoading: isLoadingAddresses, 
    error: addressError 
  } = useQuery<Address[]>({
    queryKey: ["/api/contacts", contact?.id, "addresses"],
    enabled: needsAddresses && !!contact?.id,
  });

  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {config.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{config.errorTitle}</AlertTitle>
            <AlertDescription>
              {customErrorDescription || config.errorDescription}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const isLoading = (needsPhoneNumbers && isLoadingPhones) || (needsAddresses && isLoadingAddresses);
  const hasError = (needsPhoneNumbers && phoneError) || (needsAddresses && addressError);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {config.title}
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

  if (hasError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {config.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {needsPhoneNumbers ? "Failed to load phone numbers. Please try again." : "Failed to load addresses. Please try again."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  switch (channel) {
    case "email":
      return (
        <CommEmail 
          contactId={contact.id} 
          email={contact.email}
          contactName={contact.displayName}
        />
      );
    case "sms":
      return (
        <CommSms 
          contactId={contact.id} 
          phoneNumbers={phoneNumbers || []} 
        />
      );
    case "postal":
      return (
        <CommPostal 
          contactId={contact.id} 
          addresses={addresses || []}
          contactName={contact.displayName}
        />
      );
    case "inapp":
      return <CommInApp contactId={contact.id} />;
    default:
      return null;
  }
}
