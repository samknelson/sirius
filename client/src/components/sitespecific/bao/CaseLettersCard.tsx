import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** One letter (or email copy) sent to the member about a case. */
export interface CaseLetter {
  id: string;
  commId: string;
  medium: string;
  commStatus: string;
  sent: string | null;
  statusId: string | null;
  statusName: string | null;
  description: string | null;
  createdAt: string;
}

const MEDIUM_LABELS: Record<string, string> = {
  postal: "Letter",
  email: "Email",
  sms: "SMS",
  inapp: "In-app",
};

/** Delivery outcome as recorded on the comm. */
function statusBadge(status: string) {
  const failed = status === "failed" || status === "error" || status === "bounced";
  const pending = status === "sending" || status === "pending" || status === "queued";
  return (
    <Badge variant={failed ? "destructive" : pending ? "secondary" : "outline"}>
      {status}
    </Badge>
  );
}

/**
 * The member letters sent about a case — the comm records the member-notice
 * notifier linked to it — so staff can see when the denial letter went out,
 * or that nothing was sent and why.
 */
export function CaseLettersCard({
  letters,
  mailingAddressOnFile,
  isWorkerCase,
}: {
  letters: CaseLetter[];
  mailingAddressOnFile: boolean;
  isWorkerCase: boolean;
}) {
  return (
    <Card data-testid="card-case-letters">
      <CardHeader>
        <CardTitle>Letters</CardTitle>
        <CardDescription>
          Letters and email copies sent to the member about this case.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {letters.length === 0 ? (
          <div className="space-y-1 text-sm text-muted-foreground" data-testid="text-case-letters-empty">
            <p>No letters have been sent for this case.</p>
            {isWorkerCase && !mailingAddressOnFile && (
              <p data-testid="text-case-letters-no-address">
                The member has no mailing address on file, so no letter can be mailed until one is added
                to their contact record.
              </p>
            )}
          </div>
        ) : (
          <Table data-testid="table-case-letters">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Medium</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent for</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {letters.map((letter) => (
                <TableRow key={letter.id} data-testid={`row-case-letter-${letter.id}`}>
                  <TableCell className="whitespace-nowrap">
                    {(letter.sent ?? letter.createdAt).slice(0, 16).replace("T", " ")}
                  </TableCell>
                  <TableCell>{MEDIUM_LABELS[letter.medium] ?? letter.medium}</TableCell>
                  <TableCell>{statusBadge(letter.commStatus)}</TableCell>
                  <TableCell>{letter.statusName ?? "—"}</TableCell>
                  <TableCell>
                    <Link
                      href={`/comm/${letter.commId}`}
                      className="underline-offset-2 hover:underline"
                      data-testid={`link-case-letter-${letter.id}`}
                    >
                      {letter.description ?? "(no description)"}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {letters.length > 0 && isWorkerCase && !mailingAddressOnFile && (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="text-case-letters-no-address">
            The member currently has no active mailing address on file; new letters cannot be mailed
            until one is added to their contact record.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
