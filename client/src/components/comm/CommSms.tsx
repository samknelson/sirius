import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  MessageSquare, 
  Send, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  AlertTriangle,
  Info
} from "lucide-react";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PhoneNumber {
  id: string;
  contactId: string;
  friendlyName: string | null;
  phoneNumber: string;
  isPrimary: boolean;
  isActive: boolean;
}

interface SmsOptinStatus {
  exists: boolean;
  optin: boolean;
  allowlist: boolean;
  record: {
    id: string;
    phoneNumber: string;
    optin: boolean;
    allowlist: boolean;
    optinDate?: string;
  } | null;
}

interface SystemModeResponse {
  mode: "dev" | "test" | "live";
}

interface CommSmsProps {
  contactId: string;
  phoneNumbers: PhoneNumber[];
  onSendSuccess?: () => void;
}

export function CommSms({ contactId, phoneNumbers, onSendSuccess }: CommSmsProps) {
  const { toast } = useToast();
  const [selectedPhoneId, setSelectedPhoneId] = useState<string>("");
  const [message, setMessage] = useState("");
  
  const selectedPhone = phoneNumbers.find(p => p.id === selectedPhoneId);
  
  const { data: systemMode } = useQuery<SystemModeResponse>({
    queryKey: ["/api/system-mode"],
  });

  const { data: optinStatus, isLoading: isLoadingOptin } = useQuery<SmsOptinStatus>({
    queryKey: ["/api/phone-numbers", selectedPhone?.phoneNumber, "sms-optin"],
    queryFn: async () => {
      if (!selectedPhone?.phoneNumber) return { exists: false, optin: false, allowlist: false, record: null };
      const res = await fetch(`/api/phone-numbers/${encodeURIComponent(selectedPhone.phoneNumber)}/sms-optin`);
      if (!res.ok) throw new Error("Failed to fetch opt-in status");
      return res.json();
    },
    enabled: !!selectedPhone?.phoneNumber,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const sendSmsMutation = useMutation({
    mutationFn: async ({ phoneNumber, message }: { phoneNumber: string; message: string }) => {
      const response = await apiRequest("POST", `/api/contacts/${contactId}/sms`, {
        phoneNumber,
        message,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "SMS Sent",
        description: "Your message has been sent successfully.",
      });
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "comm"] });
      onSendSuccess?.();
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to send SMS";
      toast({
        title: "Failed to Send SMS",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleSend = () => {
    if (!selectedPhone || !message.trim()) return;
    sendSmsMutation.mutate({
      phoneNumber: selectedPhone.phoneNumber,
      message: message.trim(),
    });
  };

  const canSend = 
    selectedPhone && 
    message.trim().length > 0 && 
    !isLoadingOptin &&
    optinStatus?.optin === true &&
    (systemMode?.mode === "live" || optinStatus?.allowlist === true);

  const getValidationMessage = () => {
    if (!selectedPhone) {
      return null;
    }

    if (isLoadingOptin) {
      return null;
    }

    if (!optinStatus?.optin) {
      return {
        type: "error" as const,
        title: "Not Opted In",
        message: "This phone number has not opted in to receive SMS messages. The recipient must opt in before messages can be sent.",
      };
    }

    if (systemMode?.mode !== "live" && !optinStatus?.allowlist) {
      return {
        type: "warning" as const,
        title: "Not Allowlisted",
        message: `System mode is "${systemMode?.mode}". Only allowlisted phone numbers can receive SMS in non-live modes.`,
      };
    }

    return {
      type: "success" as const,
      title: "Ready to Send",
      message: "This phone number is opted in and can receive SMS messages.",
    };
  };

  const validationMessage = getValidationMessage();
  const activePhones = phoneNumbers.filter(p => p.isActive);
  const characterCount = message.length;
  const segmentCount = Math.ceil(characterCount / 160) || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Send SMS
        </CardTitle>
        <CardDescription>
          Send an SMS message to this worker
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {activePhones.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Phone Numbers</AlertTitle>
            <AlertDescription>
              This contact does not have any active phone numbers. Add a phone number first.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="phone-select">Phone Number</Label>
              <Select 
                value={selectedPhoneId} 
                onValueChange={setSelectedPhoneId}
              >
                <SelectTrigger id="phone-select" data-testid="select-sms-phone">
                  <SelectValue placeholder="Select a phone number" />
                </SelectTrigger>
                <SelectContent>
                  {activePhones.map(phone => (
                    <SelectItem key={phone.id} value={phone.id}>
                      <div className="flex items-center gap-2">
                        {formatPhoneNumberForDisplay(phone.phoneNumber)}
                        {phone.friendlyName && (
                          <span className="text-muted-foreground">
                            ({phone.friendlyName})
                          </span>
                        )}
                        {phone.isPrimary && (
                          <Badge variant="secondary" className="text-xs">Primary</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPhone && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Label className="text-sm text-muted-foreground">Status:</Label>
                  {isLoadingOptin ? (
                    <Badge variant="outline" className="gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking...
                    </Badge>
                  ) : (
                    <>
                      <Badge 
                        variant={optinStatus?.optin ? "default" : "destructive"} 
                        className="gap-1"
                      >
                        {optinStatus?.optin ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" />
                            Opted In
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3 w-3" />
                            Not Opted In
                          </>
                        )}
                      </Badge>
                      {systemMode?.mode !== "live" && (
                        <Badge 
                          variant={optinStatus?.allowlist ? "secondary" : "outline"} 
                          className="gap-1"
                        >
                          {optinStatus?.allowlist ? "Allowlisted" : "Not Allowlisted"}
                        </Badge>
                      )}
                      {systemMode?.mode !== "live" && (
                        <Badge variant="outline" className="gap-1">
                          Mode: {systemMode?.mode}
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {validationMessage && (
              <Alert variant={validationMessage.type === "error" ? "destructive" : "default"}>
                {validationMessage.type === "error" ? (
                  <AlertCircle className="h-4 w-4" />
                ) : validationMessage.type === "warning" ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <Info className="h-4 w-4" />
                )}
                <AlertTitle>{validationMessage.title}</AlertTitle>
                <AlertDescription>{validationMessage.message}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="message">Message</Label>
                <span className="text-xs text-muted-foreground">
                  {characterCount} / 1600 characters ({segmentCount} segment{segmentCount !== 1 ? "s" : ""})
                </span>
              </div>
              <Textarea
                id="message"
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={1600}
                disabled={!selectedPhone}
                data-testid="input-sms-message"
              />
            </div>
          </>
        )}
      </CardContent>
      {activePhones.length > 0 && (
        <CardFooter className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setSelectedPhoneId("");
              setMessage("");
            }}
            disabled={sendSmsMutation.isPending}
            data-testid="button-clear-sms"
          >
            Clear
          </Button>
          <Button
            onClick={handleSend}
            disabled={!canSend || sendSmsMutation.isPending}
            data-testid="button-send-sms"
          >
            {sendSmsMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send SMS
              </>
            )}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
