import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DcDocumentsCard } from "./DcDocumentsCard";
import { DcNotesCard } from "./DcNotesCard";
import { DcStatusBadge, formatYmd } from "./dc-shared";
import type { BaoDcCase, BaoDcCaseMonth, BaoDcCaseNote } from "@shared/schema";

type Bundle = {
  case: BaoDcCase;
  months: BaoDcCaseMonth[];
  notes: BaoDcCaseNote[];
  readiness: { missing: string[]; ready: boolean };
  yearUsage: Record<string, { used: number; limit: number }>;
  denialLetters: Array<{ id: string; letterYmd: string; expiresYmd: string }>;
};

/**
 * Member view of their own DC case: status, months (read-only — members
 * never select months), documents (upload allowed), and notes. No lifecycle
 * controls are rendered and the server refuses them for non-staff anyway.
 */
export function DcMemberCasePanel({ caseId }: { caseId: string }) {
  const { data, isLoading } = useQuery<Bundle>({
    queryKey: ["/api/sitespecific/bao/dc/cases", caseId],
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data) return null;

  const activeMonths = data.months.filter((m) => m.status !== "removed");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-3">
            Case opened {formatYmd(data.case.openedYmd)}
            <DcStatusBadge status={data.case.status} />
          </CardTitle>
          <CardDescription>
            {activeMonths.length > 0
              ? `Months: ${activeMonths.map((m) => formatYmd(m.workMonthYmd).slice(0, 7)).join(", ")}`
              : "No months selected yet — a member service representative selects months."}
          </CardDescription>
        </CardHeader>
        {data.denialLetters.length > 0 && (
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.denialLetters.map((l) => (
                <Badge key={l.id} variant="outline" data-testid={`badge-dc-letter-${l.id}`}>
                  Denial letter {formatYmd(l.letterYmd)} — valid until {formatYmd(l.expiresYmd)}
                </Badge>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
      <DcDocumentsCard caseId={caseId} canSupersede={false} canSetType={false} />
      <DcNotesCard caseId={caseId} notes={data.notes} />
    </div>
  );
}
