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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  
  const hasEmail = !!email && email.trim().length > 0;

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
      <CardContent className="space-y-4">
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
  );
}
