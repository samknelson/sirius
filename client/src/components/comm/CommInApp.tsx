import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Bell, 
  Send, 
  Loader2, 
  AlertCircle,
  CheckCircle2,
  Link as LinkIcon,
  User
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CommTagPicker } from "./CommTagPicker";
import {
  ComposeTemplateStudio,
  refuseUnrenderedTokens,
} from "./ComposeTemplateStudio";
import type { ComposeTemplateTarget } from "@shared/comm-compose";
import { isSafeRelativePath } from "@shared/delivery-fields";
import { useToast } from "@/hooks/use-toast";

interface UserLookupResponse {
  hasEmail: boolean;
  hasUser: boolean;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  email?: string;
  message?: string;
}

interface CommInAppProps {
  contactId: string;
  onSendSuccess?: () => void;
  /** The record this screen is about, for composing from a template. */
  composeTarget?: ComposeTemplateTarget;
}

export function CommInApp({ contactId, onSendSuccess, composeTarget }: CommInAppProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  // An in-app notification IS plain text — it is displayed as plain
  // text, so it is written as plain text. A rich-text editor here would
  // promise formatting no reader ever sees.
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);

  const { data: userLookup, isLoading: isLoadingUserLookup } = useQuery<UserLookupResponse>({
    queryKey: ["/api/contacts", contactId, "user-lookup"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/user-lookup`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) {
          return { hasEmail: false, hasUser: false, user: null };
        }
        throw new Error("Failed to lookup user");
      }
      return res.json();
    },
    staleTime: 30000,
  });

  const sendInappMutation = useMutation({
    mutationFn: async (data: { userId: string; title: string; body: string; linkUrl?: string; linkLabel?: string; tagIds?: string[] }) => {
      return await apiRequest("POST", `/api/contacts/${contactId}/inapp`, data);
    },
    onSuccess: () => {
      toast({
        title: "In-App Message Sent",
        description: "The notification has been sent successfully.",
      });
      setTitle("");
      setBody("");
      setLinkUrl("");
      setLinkLabel("");
      setTagIds([]);
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "comm"] });
      onSendSuccess?.();
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to send in-app message";
      toast({
        title: "Failed to Send",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleSend = () => {
    if (!userLookup?.user?.id || !title.trim() || !body.trim()) return;
    // Every field that goes out, including the link: a token left
    // unrendered in a URL ships a link to "/dispatch/job/{{job.id}}".
    if (
      composeTarget &&
      refuseUnrenderedTokens({ title, body, linkUrl, linkLabel }, toast)
    )
      return;
    sendInappMutation.mutate({
      userId: userLookup.user.id,
      title: title.trim(),
      body: body.trim(),
      linkUrl: linkUrl.trim() || undefined,
      linkLabel: linkLabel.trim() || undefined,
      tagIds: tagIds.length > 0 ? tagIds : undefined,
    });
  };

  const canSend = 
    userLookup?.hasUser && 
    userLookup?.user?.id &&
    title.trim().length > 0 && 
    title.trim().length <= 100 &&
    body.trim().length > 0 &&
    body.trim().length <= 500 &&
    (!linkUrl.trim() || isSafeRelativePath(linkUrl.trim()));

  const titleCharCount = title.length;
  const bodyCharCount = body.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Send In-App Message
        </CardTitle>
        <CardDescription>
          Send an in-app notification to this contact's user account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoadingUserLookup ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking user association...
          </div>
        ) : !userLookup?.hasEmail ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Email Address</AlertTitle>
            <AlertDescription>
              This contact does not have an email address. An email is required to look up the associated user account.
            </AlertDescription>
          </Alert>
        ) : !userLookup?.hasUser ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Associated User</AlertTitle>
            <AlertDescription>
              The email address ({userLookup.email}) is not associated with a user account. 
              In-app messages can only be sent to contacts with user accounts.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert>
              <User className="h-4 w-4" />
              <AlertTitle>Recipient</AlertTitle>
              <AlertDescription>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">
                    {userLookup.user?.firstName} {userLookup.user?.lastName}
                  </span>
                  <span className="text-muted-foreground">
                    ({userLookup.user?.email})
                  </span>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="inapp-title">Title</Label>
                <span className={`text-xs ${titleCharCount > 100 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {titleCharCount}/100
                </span>
              </div>
              <Input
                id="inapp-title"
                placeholder="Notification title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                data-testid="input-inapp-title"
              />
            </div>

            {composeTarget && (
              <div className="flex justify-end">
                <ComposeTemplateStudio
                  target={composeTarget}
                  channel="inapp"
                  title="Compose In-App Message"
                  // The link is part of the notification, so it is
                  // written where the rest of it is written: a link
                  // pointing at the record this screen is about is a
                  // token like any other, and rendering it here is what
                  // makes it the same link the notifier would send.
                  fields={[
                    { key: "title", label: "Title", mode: "line", maxLength: 100 },
                    {
                      key: "body",
                      label: "Message",
                      mode: "multiline",
                      maxLength: 500,
                    },
                    { key: "linkUrl", label: "Link URL", mode: "line" },
                    { key: "linkLabel", label: "Link Label", mode: "line", maxLength: 50 },
                  ]}
                  values={{ title, body, linkUrl, linkLabel }}
                  onApply={(rendered) => {
                    setTitle(rendered.title ?? "");
                    setBody(rendered.body ?? "");
                    setLinkUrl(rendered.linkUrl ?? "");
                    setLinkLabel(rendered.linkLabel ?? "");
                  }}
                  testId="button-compose-inapp-template"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="inapp-body">Message</Label>
              <Textarea
                id="inapp-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                maxLength={500}
                placeholder="Type your notification message here"
                data-testid="input-inapp-body"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">In-app notifications display as plain text.</p>
                <span className={`text-xs ${bodyCharCount > 500 ? 'text-destructive' : 'text-muted-foreground'}`} data-testid="text-inapp-derived-body-count">
                  {bodyCharCount}/500
                </span>
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LinkIcon className="h-4 w-4" />
                Optional: Add a link to the notification
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="inapp-link-url">Link URL</Label>
                <Input
                  id="inapp-link-url"
                  placeholder="/dispatch/job/123"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  data-testid="input-inapp-link-url"
                />
                {linkUrl.trim() && !isSafeRelativePath(linkUrl.trim()) ? (
                  <p className="text-xs text-destructive">
                    Enter a link inside this app, starting with "/" — the alerts bell
                    opens it here, so an address elsewhere is dropped.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    A page in this app, starting with "/".
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="inapp-link-label">Link Label</Label>
                <Input
                  id="inapp-link-label"
                  placeholder="View Details"
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  maxLength={50}
                  data-testid="input-inapp-link-label"
                />
                <p className="text-xs text-muted-foreground">
                  The text displayed for the link (max 50 characters)
                </p>
              </div>
            </div>

            <CommTagPicker medium="inapp" value={tagIds} onChange={setTagIds} />
          </>
        )}
      </CardContent>
      
      {userLookup?.hasUser && (
        <CardFooter>
          <Button
            onClick={handleSend}
            disabled={!canSend || sendInappMutation.isPending}
            className="w-full"
            data-testid="button-send-inapp"
          >
            {sendInappMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send In-App Message
              </>
            )}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
