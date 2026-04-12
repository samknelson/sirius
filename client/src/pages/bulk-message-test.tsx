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
import { Search, Send, CheckCircle2, XCircle, Loader2, User, Mail, Phone, MapPin, Bell, AlertTriangle } from "lucide-react";

interface ContactSearchResult {
  id: string;
  displayName: string;
  email: string | null;
  given: string | null;
  family: string | null;
  primaryPhone: string | null;
  primaryAddress: string | null;
}

interface ResolvedAddress {
  medium: string;
  address: string | null;
  error?: string;
}

interface DeliverTestResult {
  success: boolean;
  commId?: string;
  comm?: {
    id: string;
    medium: string;
    contactId: string;
    status: string;
    sent: string;
    data: unknown;
  };
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
    enabled: searchQuery.trim().length >= 2 && !selectedContact,
  });

  const { data: resolvedAddr, isFetching: isResolving } = useQuery<ResolvedAddress>({
    queryKey: ["/api/bulk-messages", bulkMessage.id, "resolve-address", selectedContact?.id],
    queryFn: () => apiRequest("POST", `/api/bulk-messages/${bulkMessage.id}/resolve-address`, { contactId: selectedContact!.id }),
    enabled: !!selectedContact,
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

  const handleSelectContact = (contact: ContactSearchResult) => {
    setSelectedContact(contact);
    setSearchQuery(contact.displayName || "");
    setLastResult(null);
  };

  const handleClearContact = () => {
    setSelectedContact(null);
    setSearchQuery("");
    setLastResult(null);
  };

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
                  if (selectedContact) {
                    setSelectedContact(null);
                    setLastResult(null);
                  }
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
                  onClick={() => handleSelectContact(contact)}
                  data-testid={`button-select-contact-${contact.id}`}
                >
                  <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{contact.displayName}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {contact.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {contact.email}
                        </span>
                      )}
                      {contact.primaryPhone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {contact.primaryPhone}
                        </span>
                      )}
                      {contact.primaryAddress && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {contact.primaryAddress}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedContact && (
            <div className="border rounded-md p-4 bg-accent/30 space-y-3" data-testid="selected-contact-info">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{selectedContact.displayName}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {selectedContact.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {selectedContact.email}
                        </span>
                      )}
                      {selectedContact.primaryPhone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {selectedContact.primaryPhone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearContact}
                  data-testid="button-clear-contact"
                >
                  Clear
                </Button>
              </div>

              <div className="border-t pt-3" data-testid="resolved-address-preview">
                <div className="flex items-center gap-2 text-sm">
                  <MediumIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Resolved {mediumLabels[bulkMessage.medium] || bulkMessage.medium}:</span>
                  {isResolving ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : resolvedAddr?.address ? (
                    <span className="text-foreground" data-testid="text-preview-address">{resolvedAddr.address}</span>
                  ) : (
                    <span className="flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {resolvedAddr?.error || "No address available"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          <Button
            onClick={() => {
              if (selectedContact) {
                deliverMutation.mutate(selectedContact.id);
              }
            }}
            disabled={!selectedContact || deliverMutation.isPending || (resolvedAddr && !resolvedAddr.address)}
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
                  <span className="text-sm font-medium whitespace-nowrap">Sent to:</span>
                  <span className="text-sm text-muted-foreground" data-testid="text-resolved-address">
                    {lastResult.resolvedAddress}
                  </span>
                </div>
              )}

              {lastResult.comm && (
                <div className="bg-muted/50 rounded-md p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Comm Record</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">ID:</span>{" "}
                      <code className="text-xs bg-muted px-1 rounded" data-testid="text-comm-id">{lastResult.comm.id}</code>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status:</span>{" "}
                      <Badge variant="outline" className="text-xs" data-testid="badge-comm-status">{lastResult.comm.status}</Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Medium:</span>{" "}
                      <span>{lastResult.comm.medium}</span>
                    </div>
                    {lastResult.comm.sent && (
                      <div>
                        <span className="text-muted-foreground">Sent:</span>{" "}
                        <span>{new Date(lastResult.comm.sent).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!lastResult.comm && lastResult.commId && (
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
