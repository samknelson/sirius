import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { 
  Mail, 
  Send, 
  Loader2, 
  AlertCircle,
  Settings,
  CheckCircle,
  XCircle
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EmailOptinResponse {
  exists: boolean;
  optin: boolean;
  allowlist: boolean;
  record: {
    id: string;
    email: string;
    optin: boolean;
    optinUser: string | null;
    optinDate: string | null;
    optinIp: string | null;
    allowlist: boolean;
  } | null;
}

interface CommEmailProps {
  contactId: string;
  email?: string | null;
  contactName?: string;
  onSendSuccess?: () => void;
}

export function CommEmail({ contactId, email, contactName, onSendSuccess }: CommEmailProps) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [isOptinDialogOpen, setIsOptinDialogOpen] = useState(false);
  
  const hasEmail = !!email && email.trim().length > 0;

  const { data: emailOptinData, isLoading: isLoadingOptin } = useQuery<EmailOptinResponse>({
    queryKey: ["/api/email-optin", email],
    queryFn: async () => {
      if (!email) return null;
      const response = await fetch(`/api/email-optin/${encodeURIComponent(email)}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch email opt-in status`);
      }
      return response.json();
    },
    enabled: hasEmail,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const updateEmailOptinMutation = useMutation({
    mutationFn: async ({ emailAddress, optin, allowlist }: { emailAddress: string; optin?: boolean; allowlist?: boolean }) => {
      return await apiRequest("PUT", `/api/email-optin/${encodeURIComponent(emailAddress)}`, { optin, allowlist });
    },
    onSuccess: () => {
      if (email) {
        queryClient.invalidateQueries({ queryKey: ["/api/email-optin", email] });
      }
      toast({
        title: "Email Opt-in Updated",
        description: "The email opt-in status has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update email opt-in status",
        variant: "destructive",
      });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async (data: { email: string; name?: string; subject: string; bodyText: string }) => {
      return await apiRequest("POST", `/api/contacts/${contactId}/email`, data);
    },
    onSuccess: () => {
      toast({
        title: "Email Sent",
        description: "Your email has been sent successfully.",
      });
      setSubject("");
      setBodyText("");
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "comm"] });
      onSendSuccess?.();
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to send email";
      toast({
        title: "Failed to Send Email",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleSend = () => {
    if (!hasEmail || !subject.trim() || !bodyText.trim()) return;
    sendEmailMutation.mutate({
      email: email!.trim(),
      name: contactName?.trim() || undefined,
      subject: subject.trim(),
      bodyText: bodyText.trim(),
    });
  };

  const canSend = 
    hasEmail &&
    subject.trim().length > 0 && 
    bodyText.trim().length > 0;

  const optinModal = hasEmail && (
    <Dialog open={isOptinDialogOpen} onOpenChange={setIsOptinDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Opt-in Settings
          </DialogTitle>
          <DialogDescription>
            Manage opt-in and allowlist settings for this email address.
          </DialogDescription>
        </DialogHeader>
        
        {isLoadingOptin ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-muted-foreground">Loading opt-in status...</span>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Email Address</Label>
              <p className="font-medium">{email}</p>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email-optin" className="text-base font-medium">Opted In</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow sending emails to this address
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {emailOptinData?.optin ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Switch
                    id="email-optin"
                    checked={emailOptinData?.optin ?? false}
                    onCheckedChange={(checked) => {
                      if (email) {
                        updateEmailOptinMutation.mutate({ emailAddress: email, optin: checked });
                      }
                    }}
                    disabled={updateEmailOptinMutation.isPending}
                    data-testid="switch-email-optin"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email-allowlist" className="text-base font-medium">Allowlisted</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow sending in dev/test modes
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {emailOptinData?.allowlist ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Switch
                    id="email-allowlist"
                    checked={emailOptinData?.allowlist ?? false}
                    onCheckedChange={(checked) => {
                      if (email) {
                        updateEmailOptinMutation.mutate({ emailAddress: email, allowlist: checked });
                      }
                    }}
                    disabled={updateEmailOptinMutation.isPending}
                    data-testid="switch-email-allowlist"
                  />
                </div>
              </div>
            </div>

            {emailOptinData?.record?.optinDate && (
              <>
                <Separator />
                <div className="text-sm text-muted-foreground">
                  <p>Opted in on: {new Date(emailOptinData.record.optinDate).toLocaleString()}</p>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  if (!hasEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Email
          </CardTitle>
          <CardDescription>
            Send an email to this contact
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Email Address</AlertTitle>
            <AlertDescription>
              This contact does not have an email address on file. Please add an email address to their contact record before sending an email.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {optinModal}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Send Email
            </CardTitle>
            <CardDescription>
              Send an email to this contact
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsOptinDialogOpen(true)}
            data-testid="button-email-optin-settings"
          >
            <Settings className="h-4 w-4 mr-2" />
            Opt-in Settings
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!emailOptinData?.optin && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Email Not Opted In</AlertTitle>
              <AlertDescription>
                This email address has not opted in to receive emails. Click "Opt-in Settings" to enable.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="to-email">To Email</Label>
              <Input
                id="to-email"
                type="email"
                value={email}
                disabled
                className="bg-muted"
                data-testid="input-email-to"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to-name">Recipient Name</Label>
              <Input
                id="to-name"
                type="text"
                value={contactName || ""}
                disabled
                className="bg-muted"
                data-testid="input-email-name"
              />
            </div>
          </div>

        <div className="space-y-2">
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            type="text"
            placeholder="Email subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={500}
            data-testid="input-email-subject"
          />
          <div className="flex justify-end">
            <span className="text-xs text-muted-foreground">
              {subject.length} / 500 characters
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="body">Message</Label>
          <Textarea
            id="body"
            placeholder="Type your message here..."
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={8}
            data-testid="input-email-body"
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setSubject("");
            setBodyText("");
          }}
          disabled={sendEmailMutation.isPending}
          data-testid="button-clear-email"
        >
          Clear
        </Button>
        <Button
          onClick={handleSend}
          disabled={!canSend || sendEmailMutation.isPending}
          data-testid="button-send-email"
        >
          {sendEmailMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Send Email
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
    </>
  );
}
