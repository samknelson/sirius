import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CommLayout } from "@/components/layouts/CommLayout";
import { useCommTabAccess } from "@/hooks/useTabAccess";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
/*
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  MessageSquare,
  FileText,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  Send,
  Inbox,
  Phone,
  Mail,
  Tag as TagIcon,
  WifiOff,
} from "lucide-react";
import { format } from "date-fns";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";
import { CommWithDetails, interactionChannelLabel } from "@/lib/comm-types";
import { WinstonLog } from "@/lib/system-types";
*/
import { ArrowLeft, AlertCircle, WifiOff } from "lucide-react";
import { CommWithDetails } from "@/lib/comm-types";
import { CommDetailContent } from "@/components/comm/CommDetailContent";

export default function CommDetail() {
  const { commId } = useParams<{ commId: string }>();
  const { toast } = useToast();
  const [isOfflineConfirmOpen, setIsOfflineConfirmOpen] = useState(false);

  const { data: comm } = useQuery<CommWithDetails>({
    queryKey: ["/api/comm", commId],
    enabled: !!commId,
  });

  const { tabs } = useCommTabAccess(commId);
  const canEdit = tabs.some((t) => t.id === "edit");

  const markOfflineMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", `/api/comm/${commId}`, { status: "offline" });
    },
    onSuccess: () => {
      toast({
        title: "Marked as offline mailed",
        description: "The status was updated to offline.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/comm", commId] });
      if (comm?.contactId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/contacts", comm.contactId, "comm"],
        });
      }
      setIsOfflineConfirmOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update status",
        description: getApiErrorMessage(error, "An unexpected error occurred."),
        variant: "destructive",
      });
    },
  });

  const statusAction =
    canEdit &&
    comm?.medium === "postal" &&
    (comm.status === "queued" || comm.status === "sending") ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOfflineConfirmOpen(true)}
        data-testid="button-mark-offline-mailed"
      >
        <WifiOff className="w-3 h-3 mr-1" />
        Mark as offline mailed
      </Button>
    ) : null;

  return (
    <CommLayout activeTab="details">
      {/*
      <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Message Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {comm.tags && comm.tags.length > 0 && (
            <div>
              <Label className="text-muted-foreground">Tags</Label>
              <div className="flex flex-wrap gap-2 mt-2" data-testid="tags-comm-detail">
                {comm.tags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="secondary"
                    className="gap-1"
                    data-testid={`badge-detail-tag-${tag.id}`}
                  >
                    <TagIcon className="h-3 w-3" />
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label className="text-muted-foreground">Medium</Label>
              <div className="flex items-center gap-2 mt-1">
                {comm.medium === "sms" && <Phone className="w-4 h-4" />}
                {comm.medium === "email" && <Mail className="w-4 h-4" />}
                {comm.medium === "interaction" && <Phone className="w-4 h-4" />}
                <span className="capitalize font-medium" data-testid="text-comm-medium">{comm.medium}</span>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Status</Label>
              <div className="mt-1 flex items-center gap-2 flex-wrap" data-testid="text-comm-status">
                {getStatusBadge(comm.status)}
                {canEdit &&
                  comm.medium === "postal" &&
                  (comm.status === "queued" || comm.status === "sending") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsOfflineConfirmOpen(true)}
                      data-testid="button-mark-offline-mailed"
                    >
                      <WifiOff className="w-3 h-3 mr-1" />
                      Mark as offline mailed
                    </Button>
                  )}
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Sent</Label>
              <div className="font-mono text-sm mt-1" data-testid="text-comm-sent">
                {formatDate(comm.sent)}
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">To</Label>
              <div className="font-mono text-sm mt-1" data-testid="text-comm-to">
                {comm.medium === 'sms' && comm.smsDetails?.to 
                  ? formatPhoneNumberForDisplay(comm.smsDetails.to)
                  : comm.medium === 'email' && comm.emailDetails?.to
                    ? comm.emailDetails.to
                    : comm.medium === 'postal' && comm.postalDetails
                      ? (
                        <div className="space-y-0.5">
                          {comm.postalDetails.toName && <div>{comm.postalDetails.toName}</div>}
                          {comm.postalDetails.toAddressLine1 && <div>{comm.postalDetails.toAddressLine1}</div>}
                          {comm.postalDetails.toAddressLine2 && <div>{comm.postalDetails.toAddressLine2}</div>}
                          <div>
                            {[comm.postalDetails.toCity, comm.postalDetails.toState, comm.postalDetails.toZip].filter(Boolean).join(', ')}
                          </div>
                        </div>
                      )
                      : comm.medium === 'interaction' && comm.interactionDetails
                        ? interactionChannelLabel(comm.interactionDetails.channel)
                        : "-"}
              </div>
            </div>
          </div>

          {comm.interactionDetails && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Channel</Label>
                  <div className="mt-1 text-sm" data-testid="text-interaction-channel">
                    {interactionChannelLabel(comm.interactionDetails.channel)}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Reason</Label>
                  <div className="mt-1 text-sm" data-testid="text-interaction-reason">
                    {comm.interactionDetails.reasonName || "-"}
                  </div>
                </div>
              </div>
              {comm.interactionDetails.notes && (
                <div>
                  <Label className="text-muted-foreground">Notes</Label>
                  <div
                    className="mt-2 p-4 bg-muted rounded-md whitespace-pre-wrap text-sm"
                    data-testid="text-interaction-notes"
                  >
                    {comm.interactionDetails.notes}
                  </div>
                </div>
              )}
              {comm.interactionDetails.data && Object.keys(comm.interactionDetails.data).length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Interaction Data</Label>
                  <pre
                    className="mt-2 p-4 bg-muted rounded-md text-xs overflow-x-auto"
                    data-testid="text-comm-interaction-data"
                  >
                    {JSON.stringify(comm.interactionDetails.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {comm.smsDetails?.body && (
            <div>
              <Label className="text-muted-foreground">Message Body</Label>
              <div 
                className="mt-2 p-4 bg-muted rounded-md whitespace-pre-wrap text-sm"
                data-testid="text-comm-body"
              >
                {comm.smsDetails.body}
              </div>
            </div>
          )}

          {comm.emailDetails?.subject && (
            <div>
              <Label className="text-muted-foreground">Subject</Label>
              <div 
                className="mt-2 p-4 bg-muted rounded-md text-sm"
                data-testid="text-comm-subject"
              >
                {comm.emailDetails.subject}
              </div>
            </div>
          )}

          {comm.emailDetails?.bodyText && (
            <div>
              <Label className="text-muted-foreground">Email Body</Label>
              <div 
                className="mt-2 p-4 bg-muted rounded-md whitespace-pre-wrap text-sm"
                data-testid="text-comm-email-body"
              >
                {comm.emailDetails.bodyText}
              </div>
            </div>
          )}

          {comm.smsDetails?.data && Object.keys(comm.smsDetails.data).length > 0 && (
            <div>
              <Label className="text-muted-foreground">SMS Data</Label>
              <pre 
                className="mt-2 p-4 bg-muted rounded-md text-xs overflow-x-auto"
                data-testid="text-comm-sms-data"
              >
                {JSON.stringify(comm.smsDetails.data, null, 2)}
              </pre>
            </div>
          )}

          {comm.emailDetails?.data && Object.keys(comm.emailDetails.data).length > 0 && (
            <div>
              <Label className="text-muted-foreground">Email Data</Label>
              <pre 
                className="mt-2 p-4 bg-muted rounded-md text-xs overflow-x-auto"
                data-testid="text-comm-email-data"
              >
                {JSON.stringify(comm.emailDetails.data, null, 2)}
              </pre>
            </div>
          )}

          {comm.postalDetails && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {comm.postalDetails.description && (
                  <div>
                    <Label className="text-muted-foreground">Description</Label>
                    <div className="mt-1 text-sm" data-testid="text-postal-description">
                      {comm.postalDetails.description}
                    </div>
                  </div>
                )}
                {comm.postalDetails.mailType && (
                  <div>
                    <Label className="text-muted-foreground">Mail Type</Label>
                    <div className="mt-1 text-sm" data-testid="text-postal-mail-type">
                      {comm.postalDetails.mailType === 'usps_first_class' ? 'USPS First Class' : 
                       comm.postalDetails.mailType === 'usps_standard' ? 'USPS Standard' : 
                       comm.postalDetails.mailType}
                    </div>
                  </div>
                )}
              </div>
              {comm.postalDetails.body && (
                <div>
                  <Label className="text-muted-foreground">Letter Body</Label>
                  <iframe
                    title="Letter body preview"
                    sandbox=""
                    srcDoc={comm.postalDetails.body}
                    className="mt-1 w-full h-96 rounded-md border bg-white"
                    data-testid="iframe-postal-body"
                  />
                </div>
              )}
              {comm.postalDetails.fromName && (
                <div>
                  <Label className="text-muted-foreground">From</Label>
                  <div className="font-mono text-sm mt-1 space-y-0.5" data-testid="text-postal-from">
                    <div>{comm.postalDetails.fromName}</div>
                    {comm.postalDetails.fromAddressLine1 && <div>{comm.postalDetails.fromAddressLine1}</div>}
                    {comm.postalDetails.fromAddressLine2 && <div>{comm.postalDetails.fromAddressLine2}</div>}
                    <div>
                      {[comm.postalDetails.fromCity, comm.postalDetails.fromState, comm.postalDetails.fromZip].filter(Boolean).join(', ')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {comm.postalDetails?.data && Object.keys(comm.postalDetails.data).length > 0 && (
            <div>
              <Label className="text-muted-foreground">Postal Data</Label>
              <pre 
                className="mt-2 p-4 bg-muted rounded-md text-xs overflow-x-auto"
                data-testid="text-comm-postal-data"
              >
                {JSON.stringify(comm.postalDetails.data, null, 2)}
              </pre>
            </div>
          )}

          {comm.data && Object.keys(comm.data).length > 0 && (
            <div>
              <Label className="text-muted-foreground">Communication Data</Label>
              <pre 
                className="mt-2 p-4 bg-muted rounded-md text-xs overflow-x-auto"
                data-testid="text-comm-data"
              >
                {JSON.stringify(comm.data, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Activity Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="module-filter">Module</Label>
              <Input
                id="module-filter"
                placeholder="Filter by module"
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
                list="modules-list"
                data-testid="input-module-filter"
              />
              <datalist id="modules-list">
                {uniqueModules.map((module) => (
                  <option key={module} value={module || ""} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="operation-filter">Operation</Label>
              <Input
                id="operation-filter"
                placeholder="Filter by operation"
                value={operationFilter}
                onChange={(e) => setOperationFilter(e.target.value)}
                list="operations-list"
                data-testid="input-operation-filter"
              />
              <datalist id="operations-list">
                {uniqueOperations.map((operation) => (
                  <option key={operation} value={operation || ""} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
              />
            </div>
            <div>
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-end-date"
              />
            </div>
          </div>

          {(moduleFilter || operationFilter || startDate || endDate) && (
            <div className="mb-4 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                data-testid="button-clear-filters"
              >
                <Filter className="w-4 h-4 mr-2" />
                Clear Filters
              </Button>
            </div>
          )}

          {logsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading logs...</div>
          ) : logs.length === 0 ? (
      */}
      <CommDetailContent
        commId={commId}
        statusAction={statusAction}
        renderFallback={({ isLoading }) =>
          isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading communication details...
            </div>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
                  <p className="text-muted-foreground">Communication record not found.</p>
                  <Button variant="outline" className="mt-4" asChild>
                    <Link href="/">
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Go Back
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        }
      />

      <AlertDialog open={isOfflineConfirmOpen} onOpenChange={setIsOfflineConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-offline-mailed">
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as offline mailed?</AlertDialogTitle>
            <AlertDialogDescription>
              This sets the status to "offline", meaning the comm was delivered
              out-of-band (e.g. printed and dropped in the mail). Delivery
              state will be unverifiable afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-offline-mailed">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                markOfflineMutation.mutate();
              }}
              disabled={markOfflineMutation.isPending}
              data-testid="button-confirm-offline-mailed"
            >
              {markOfflineMutation.isPending ? "Saving..." : "Mark as offline mailed"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommLayout>
  );
}
