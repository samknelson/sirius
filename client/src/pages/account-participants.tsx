import { LedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { stringify } from "csv-stringify/browser/esm/sync";

interface AccountParticipant {
  eaId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  totalBalance: number;
  firstEntryDate: string | null;
  lastEntryDate: string | null;
  entryCount: number;
}

const ITEMS_PER_PAGE = 20;

function AccountParticipantsContent() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [page, setPage] = useState(0);

  const { data: result, isLoading } = useQuery<{ data: AccountParticipant[]; total: number }>({
    queryKey: [`/api/ledger/accounts/${id}/participants`, page],
    queryFn: async () => {
      const response = await fetch(
        `/api/ledger/accounts/${id}/participants?limit=${ITEMS_PER_PAGE}&offset=${page * ITEMS_PER_PAGE}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch participants");
      }
      return response.json();
    },
  });

  const participants = result?.data || [];
  const total = result?.total || 0;
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  const formatAmount = (amount: number) => {
    const formatted = Math.abs(amount).toFixed(2);
    return amount >= 0 ? `$${formatted}` : `($${formatted})`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return "—";
    }
  };

  const getEntityLink = (participant: AccountParticipant) => {
    if (participant.entityType === "employer") {
      return `/employers/${participant.entityId}`;
    } else if (participant.entityType === "worker") {
      return `/workers/${participant.entityId}`;
    } else if (participant.entityType === "trust_provider") {
      return `/trust/provider/${participant.entityId}`;
    }
    return null;
  };

  const exportToCSV = () => {
    if (participants.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no participants to export.",
        variant: "destructive",
      });
      return;
    }

    const csvData = participants.map((participant) => ({
      "Entity Type": participant.entityType,
      "Entity Name": participant.entityName || "",
      "Total Balance": participant.totalBalance.toFixed(2),
      "First Entry Date": formatDate(participant.firstEntryDate),
      "Last Entry Date": formatDate(participant.lastEntryDate),
      "Entry Count": participant.entryCount,
      "EA ID": participant.eaId,
      "Entity ID": participant.entityId,
    }));

    const csv = stringify(csvData, {
      header: true,
      columns: [
        "Entity Type",
        "Entity Name",
        "Total Balance",
        "First Entry Date",
        "Last Entry Date",
        "Entry Count",
        "EA ID",
        "Entity ID",
      ],
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `account-participants-${id}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export successful",
      description: `Exported ${participants.length} participant(s) to CSV.`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Participants</CardTitle>
            <CardDescription>
              Entities associated with this account ({total} total)
            </CardDescription>
          </div>
          <Button
            onClick={exportToCSV}
            variant="outline"
            size="sm"
            disabled={isLoading || participants.length === 0}
            data-testid="button-export-csv"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : participants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground" data-testid="text-no-participants">
              No participants found for this account
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Entity Name</TableHead>
                    <TableHead className="text-right">Total Balance</TableHead>
                    <TableHead>First Entry</TableHead>
                    <TableHead>Last Entry</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead>Links</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {participants.map((participant) => {
                    const entityLink = getEntityLink(participant);
                    return (
                      <TableRow key={participant.eaId} data-testid={`row-participant-${participant.eaId}`}>
                        <TableCell className="capitalize" data-testid={`cell-entity-type-${participant.eaId}`}>
                          {participant.entityType}
                        </TableCell>
                        <TableCell data-testid={`cell-entity-name-${participant.eaId}`}>
                          {participant.entityName || "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right ${participant.totalBalance < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                          data-testid={`cell-balance-${participant.eaId}`}
                        >
                          {formatAmount(participant.totalBalance)}
                        </TableCell>
                        <TableCell data-testid={`cell-first-date-${participant.eaId}`}>
                          {formatDate(participant.firstEntryDate)}
                        </TableCell>
                        <TableCell data-testid={`cell-last-date-${participant.eaId}`}>
                          {formatDate(participant.lastEntryDate)}
                        </TableCell>
                        <TableCell className="text-right" data-testid={`cell-entry-count-${participant.eaId}`}>
                          {participant.entryCount}
                        </TableCell>
                        <TableCell data-testid={`cell-links-${participant.eaId}`}>
                          <div className="flex gap-1">
                            <Link href={`/ea/${participant.eaId}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                title="View EA record"
                                data-testid={`button-link-ea-${participant.eaId}`}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </Link>
                            {entityLink && (
                              <Link href={entityLink}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2"
                                  title={`View ${participant.entityType}`}
                                  data-testid={`button-link-entity-${participant.eaId}`}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </Link>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Showing {page * ITEMS_PER_PAGE + 1} to {Math.min((page + 1) * ITEMS_PER_PAGE, total)} of {total} participants
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    data-testid="button-prev-page"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    data-testid="button-next-page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function AccountParticipants() {
  return (
    <LedgerAccountLayout activeTab="participants">
      <AccountParticipantsContent />
    </LedgerAccountLayout>
  );
}
