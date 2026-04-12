import { useState } from "react";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Search, Send, CheckCircle2, XCircle, Loader2, User, Mail, Phone, MapPin, Bell } from "lucide-react";

interface ContactSearchResult {
  id: string;
  displayName: string;
  email: string | null;
  given: string | null;
  family: string | null;
}

interface DeliverTestResult {
  success: boolean;
  commId?: string;
  error?: string;
  errorCode?: string;
  resolvedAddress?: string;
}

const mediumIcons: Record<string, typeof Mail> = {
  email: Mail,
  sms: Phone,
  postal: MapPin,
  inapp: Bell,
};

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  postal: "Postal Address",
  inapp: "In-App (User Account)",
};

function BulkMessageTestContent() {
  const { bulkMessage } = useBulkMessageLayout();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null);
  const [lastResult, setLastResult] = useState<DeliverTestResult | null>(null);

  const { data: searchResults = [], isFetching: isSearching } = useQuery<ContactSearchResult[]>({
    queryKey: ["/api/contacts/search", searchQuery],
    queryFn: () => apiRequest("GET", `/api/contacts/search?q=${encodeURIComponent(searchQuery)}`),
    enabled: searchQuery.trim().length >= 2,
  });

  const deliverMutation = useMutation({
    mutationFn: async (contactId: string) => {
      return apiRequest("POST", `/api/bulk-messages/${bulkMessage.id}/deliver-test`, { contactId }) as Promise<DeliverTestResult>;
    },
    onSuccess: (result) => {
      setLastResult(result);
      if (result.success) {
        toast({ title: "Test message sent", description: `Delivered to ${result.resolvedAddress || "contact"}` });
      } else {
        toast({
          title: "Test delivery failed",
          description: result.error || "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      setLastResult({ success: false, error: error.message });
      toast({
        title: "Error sending test",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const MediumIcon = mediumIcons[bulkMessage.medium] || Mail;

  return (
    <div className="space-y-6">
      <Card data-testid="card-bulk-test">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send Test Message
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-4 flex items-center gap-3">
            <MediumIcon className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Medium: {mediumLabels[bulkMessage.medium] || bulkMessage.medium}</p>
              <p className="text-xs text-muted-foreground">
                Select a contact below to send a test delivery of this bulk message.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-search">Search for a contact</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="contact-search"
                placeholder="Type a name or email to search..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (selectedContact) setSelectedContact(null);
                  setLastResult(null);
                }}
                data-testid="input-contact-search"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {searchQuery.trim().length >= 2 && !selectedContact && (
            <div className="border rounded-md max-h-60 overflow-y-auto" data-testid="list-contact-search-results">
              {searchResults.length === 0 && !isSearching && (
                <p className="p-4 text-sm text-muted-foreground text-center">No contacts found</p>
              )}
              {searchResults.map((contact) => (
                <button
                  key={contact.id}
                  className="w-full text-left px-4 py-3 hover:bg-accent transition-colors border-b last:border-b-0 flex items-center gap-3"
                  onClick={() => {
                    setSelectedContact(contact);
                    setSearchQuery(contact.displayName || "");
                    setLastResult(null);
                  }}
                  data-testid={`button-select-contact-${contact.id}`}
                >
                  <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{contact.displayName}</p>
                    {contact.email && (
                      <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedContact && (
            <div className="border rounded-md p-4 bg-accent/30" data-testid="selected-contact-info">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{selectedContact.displayName}</p>
                    {selectedContact.email && (
                      <p className="text-xs text-muted-foreground">{selectedContact.email}</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedContact(null);
                    setSearchQuery("");
                    setLastResult(null);
                  }}
                  data-testid="button-clear-contact"
                >
                  Clear
                </Button>
              </div>
            </div>
          )}

          <Button
            onClick={() => {
              if (selectedContact) {
                deliverMutation.mutate(selectedContact.id);
              }
            }}
            disabled={!selectedContact || deliverMutation.isPending}
            className="w-full"
            data-testid="button-send-test"
          >
            {deliverMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Test to {selectedContact?.displayName || "Selected Contact"}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {lastResult && (
        <Card data-testid="card-test-result">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {lastResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              Test Result
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Status:</span>
                <Badge variant={lastResult.success ? "default" : "destructive"} data-testid="badge-test-status">
                  {lastResult.success ? "Delivered" : "Failed"}
                </Badge>
              </div>

              {lastResult.resolvedAddress && (
                <div className="flex items-start gap-2">
                  <span className="text-sm font-medium whitespace-nowrap">Resolved Address:</span>
                  <span className="text-sm text-muted-foreground" data-testid="text-resolved-address">
                    {lastResult.resolvedAddress}
                  </span>
                </div>
              )}

              {lastResult.commId && (
                <div className="flex items-start gap-2">
                  <span className="text-sm font-medium whitespace-nowrap">Comm ID:</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded" data-testid="text-comm-id">
                    {lastResult.commId}
                  </code>
                </div>
              )}

              {lastResult.error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  <p className="text-sm text-destructive" data-testid="text-test-error">
                    {lastResult.error}
                  </p>
                  {lastResult.errorCode && (
                    <p className="text-xs text-destructive/70 mt-1">Code: {lastResult.errorCode}</p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function BulkMessageTestPage() {
  return (
    <BulkMessageLayout activeTab="test">
      <BulkMessageTestContent />
    </BulkMessageLayout>
  );
}
