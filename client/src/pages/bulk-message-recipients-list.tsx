import { useState, useMemo } from "react";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Search, Trash2, ExternalLink, Users, Download } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface EnrichedParticipant {
  id: string;
  messageId: string;
  contactId: string;
  commId: string | null;
  data: unknown;
  contactDisplayName: string;
  contactGiven: string | null;
  contactFamily: string | null;
  workerId: string | null;
  workerSiriusId: number | null;
  commStatus: string | null;
}

function BulkMessageRecipientsListContent() {
  const { bulkMessage } = useBulkMessageLayout();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: participants = [], isLoading } = useQuery<EnrichedParticipant[]>({
    queryKey: ["/api/bulk-messages", bulkMessage.id, "participants"],
    queryFn: () => apiRequest("GET", `/api/bulk-messages/${bulkMessage.id}/participants`),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return participants;
    const q = search.toLowerCase();
    return participants.filter(p =>
      p.contactDisplayName?.toLowerCase().includes(q) ||
      p.contactGiven?.toLowerCase().includes(q) ||
      p.contactFamily?.toLowerCase().includes(q) ||
      p.commStatus?.toLowerCase().includes(q)
    );
  }, [participants, search]);

  const handleExportCsv = () => {
    const rows = filtered.length > 0 ? filtered : participants;
    const csvContent = [
      ["Name", "Status", "Worker ID", "Comm ID"].join(","),
      ...rows.map(p => [
        `"${(p.contactDisplayName || "").replace(/"/g, '""')}"`,
        p.commStatus || "",
        p.workerSiriusId != null ? String(p.workerSiriusId) : "",
        p.commId || "",
      ].join(","))
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bulkMessage.name.replace(/[^a-zA-Z0-9]/g, "_")}_recipients.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removeMutation = useMutation({
    mutationFn: async (participantId: string) => {
      await apiRequest("DELETE", `/api/bulk-messages/${bulkMessage.id}/participants/${participantId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "participants"] });
      toast({ title: "Recipient removed" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error removing recipient",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card data-testid="card-bulk-recipients-list">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-3">
          <CardTitle data-testid="text-recipients-list-title">Recipients</CardTitle>
          <Badge variant="secondary" data-testid="badge-recipient-count">
            {participants.length}
          </Badge>
        </div>
        {participants.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            data-testid="button-export-csv"
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter recipients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-filter-recipients"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3" data-testid="skeleton-recipients">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : participants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="empty-recipients">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No recipients have been added yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Go to the Add tab to select workers as recipients.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-recipients">
                <thead className="bg-muted/20">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Links
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-background divide-y divide-border">
                  {filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-participant-${p.id}`}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm font-medium" data-testid={`text-participant-name-${p.id}`}>
                          {p.contactDisplayName}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {p.commStatus ? (
                          <Badge
                            variant={p.commStatus === "sent" ? "default" : "secondary"}
                            data-testid={`badge-comm-status-${p.id}`}
                          >
                            {p.commStatus}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground italic" data-testid={`text-no-comm-${p.id}`}>
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {p.workerId && (
                            <Link href={`/workers/${p.workerId}`}>
                              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid={`link-worker-${p.id}`}>
                                <ExternalLink size={12} />
                                Worker
                              </Button>
                            </Link>
                          )}
                          {p.commId && (
                            <Link href={`/comm/${p.commId}`}>
                              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid={`link-comm-${p.id}`}>
                                <ExternalLink size={12} />
                                Comm
                              </Button>
                            </Link>
                          )}
                          {!p.workerId && !p.commId && (
                            <span className="text-sm text-muted-foreground italic">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-destructive hover:text-destructive"
                              disabled={removeMutation.isPending}
                              data-testid={`button-remove-participant-${p.id}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent data-testid={`dialog-remove-participant-${p.id}`}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove Recipient</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to remove {p.contactDisplayName} from this bulk message?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid="button-cancel-remove">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => removeMutation.mutate(p.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                data-testid="button-confirm-remove"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && search.trim() && (
              <div className="py-8 text-center" data-testid="empty-filter-results">
                <p className="text-sm text-muted-foreground">
                  No recipients match "{search}".
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function BulkMessageRecipientsListPage() {
  return (
    <BulkMessageLayout activeTab="recipients-list">
      <BulkMessageRecipientsListContent />
    </BulkMessageLayout>
  );
}
