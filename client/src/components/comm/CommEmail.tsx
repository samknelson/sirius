import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Mail, 
  Send, 
  Loader2, 
  AlertCircle
} from "lucide-react";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CommTagPicker } from "./CommTagPicker";
import {
  ComposeTemplateStudio,
  refuseUnrenderedTokens,
} from "./ComposeTemplateStudio";
import type { ComposeTemplateTarget } from "@shared/comm-compose";
import EmailOptinSettings from "@/components/comm/EmailOptinSettings";

interface CommEmailProps {
  contactId: string;
  email?: string | null;
  contactName?: string;
  onSendSuccess?: () => void;
  /** The record this screen is about, for composing from a template. */
  composeTarget?: ComposeTemplateTarget;
}

export function CommEmail({ contactId, email, contactName, onSendSuccess, composeTarget }: CommEmailProps) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  // An email body is HTML — the same field the bulk and notifier
  // surfaces author. The plain-text alternative part is derived from it
  // at send, never written here.
  const [bodyHtml, setBodyHtml] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [emailIsOptedIn, setEmailIsOptedIn] = useState<boolean | null>(null);
  
  const hasEmail = !!email && email.trim().length > 0;

  const sendEmailMutation = useMutation({
    mutationFn: async (data: { email: string; name?: string; subject: string; bodyHtml: string; tagIds?: string[]; sendOffline?: boolean }) => {
      return await apiRequest("POST", `/api/contacts/${contactId}/email`, data);
    },
    onSuccess: (_data, variables) => {
      toast({
        title: variables.sendOffline ? "Recorded as Sent Offline" : "Email Sent",
        description: variables.sendOffline
          ? "The email has been recorded as sent offline."
          : "Your email has been sent successfully.",
      });
      setSubject("");
      setBodyHtml("");
      setTagIds([]);
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "comm"] });
      onSendSuccess?.();
    },
    onError: (error: any, variables) => {
      const errorMessage = error?.message || "Failed to send email";
      toast({
        title: variables.sendOffline ? "Failed to Record Offline Email" : "Failed to Send Email",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleSend = (sendOffline = false) => {
    if (!hasEmail || !subject.trim() || !bodyHtml.trim()) return;
    if (composeTarget && refuseUnrenderedTokens({ subject, bodyHtml }, toast)) return;
    sendEmailMutation.mutate({
      email: email!.trim(),
      name: contactName?.trim() || undefined,
      subject: subject.trim(),
      bodyHtml: bodyHtml.trim(),
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      sendOffline: sendOffline || undefined,
    });
  };

  const canSend = 
    hasEmail &&
    subject.trim().length > 0 && 
    bodyHtml.trim().length > 0;

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
          <EmailOptinSettings
            email={email}
            onStatusChange={(status) => setEmailIsOptedIn(status?.optin ?? null)}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {emailIsOptedIn === false && (
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

        {composeTarget && (
          <div className="flex justify-end">
            <ComposeTemplateStudio
              target={composeTarget}
              channel="email"
              title="Compose Email"
              fields={[
                { key: "subject", label: "Subject", mode: "line", maxLength: 500 },
                { key: "bodyHtml", label: "Message", mode: "html" },
              ]}
              values={{ subject, bodyHtml }}
              onApply={(rendered) => {
                setSubject(rendered.subject ?? "");
                setBodyHtml(rendered.bodyHtml ?? "");
              }}
              testId="button-compose-email-template"
            />
          </div>
        )}

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
          <div data-testid="input-email-body">
            <SimpleHtmlEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Type your message here..."
              minHeight={200}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A plain-text version is generated automatically for recipients whose mail client can't display HTML.
          </p>
        </div>

        <CommTagPicker medium="email" value={tagIds} onChange={setTagIds} />
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setSubject("");
            setBodyHtml("");
            setTagIds([]);
          }}
          disabled={sendEmailMutation.isPending}
          data-testid="button-clear-email"
        >
          Clear
        </Button>
        <Button
          variant="secondary"
          onClick={() => handleSend(true)}
          disabled={!canSend || sendEmailMutation.isPending}
          data-testid="button-send-email-offline"
        >
          <Send className="h-4 w-4 mr-2" />
          Send offline
        </Button>
        <Button
          onClick={() => handleSend(false)}
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
