import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Calendar, ClipboardList, Clock, Star, User, Users } from "lucide-react";
import { formatYmd } from "@shared/utils/date";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface WorkerAssignmentDetail {
  sheetId: string;
  sheetName: string;
  sheetYmd: string;
  sheetStatus: string;
  crewId: string;
  crewName: string;
  startTime: string | null;
  endTime: string | null;
  supervisorName: string | null;
  canViewSheet?: boolean;
}

interface WorkerAssignmentDetails {
  workerId: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
  prior: WorkerAssignmentDetail | null;
  current: WorkerAssignmentDetail | null;
  next: WorkerAssignmentDetail | null;
}

interface WorkerRatingWithType {
  id: string;
  value: number;
  ratingType: { id: string; name: string } | null;
}

export function WorkerAssignmentDetailsDialog({
  workerId,
  queryUrl,
  open,
  onOpenChange,
  ratingsEnabled = false,
}: {
  workerId: string;
  queryUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ratingsEnabled?: boolean;
}) {
  const { data: details, isLoading, isError } = useQuery<WorkerAssignmentDetails>({
    queryKey: [queryUrl],
    queryFn: async () => {
      const response = await fetch(queryUrl, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch assignment details");
      return response.json();
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Worker Assignment Details</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : isError ? (
          <div className="text-destructive">Unable to load assignment details.</div>
        ) : details ? (
          <div className="space-y-4">
            <div className="border-b pb-3">
              <div className="text-lg font-semibold">{formatWorkerFullName(details)}</div>
              <div className="flex gap-2 mt-1">
                {details.siriusId && <Badge variant="secondary">ID: {details.siriusId}</Badge>}
                <Badge variant="outline">Worker ID: {details.workerId.slice(0, 8)}...</Badge>
              </div>
            </div>
            <div className="space-y-3">
              <AssignmentDetailCard label="Prior Assignment" detail={details.prior} />
              <AssignmentDetailCard label="Current Assignment (Same Day)" detail={details.current} />
              <AssignmentDetailCard label="Next Assignment" detail={details.next} />
            </div>
            <WorkerRatingsSection workerId={workerId} ratingsEnabled={ratingsEnabled} />
          </div>
        ) : <div className="text-muted-foreground">No details available</div>}
      </DialogContent>
    </Dialog>
  );
}

function formatWorkerFullName(details: WorkerAssignmentDetails): string {
  if (details.displayName) return details.displayName;
  if (details.given || details.family) return [details.given, details.family].filter(Boolean).join(" ");
  return details.siriusId ? `Worker #${details.siriusId}` : "Unknown Worker";
}

function getStatusCardStyle(status: string): string {
  switch (status) {
    case "draft": return "bg-gray-100 dark:bg-gray-800 border-l-4 border-l-gray-400";
    case "request": return "bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-l-yellow-400";
    case "lock": return "bg-green-50 dark:bg-green-900/20 border-l-4 border-l-green-500";
    case "trash": return "bg-red-50 dark:bg-red-900/20 border-l-4 border-l-red-500";
    case "reserved": return "bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500";
    default: return "bg-muted/50";
  }
}

function AssignmentDetailCard({ label, detail }: { label: string; detail: WorkerAssignmentDetail | null }) {
  if (!detail) return <div className="p-3 rounded-md bg-muted/50"><div className="text-xs text-muted-foreground font-medium mb-1">{label}</div><div className="text-sm text-muted-foreground italic">No assignment</div></div>;
  const sheetName = detail.canViewSheet === false ? (
    <span className="font-medium">{detail.sheetName}</span>
  ) : (
    <Link href={`/edls/sheet/${detail.sheetId}`} className="font-medium text-primary hover:underline" data-testid={`link-sheet-${detail.sheetId}`}>{detail.sheetName}</Link>
  );
  return (
    <div className={`p-3 rounded-md ${getStatusCardStyle(detail.sheetStatus)}`}>
      <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground font-medium">{label}</span><Badge variant="outline">{detail.sheetStatus}</Badge></div>
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-2"><ClipboardList className="h-3 w-3 text-muted-foreground" />{sheetName}</div>
        <div className="flex items-center gap-2"><Calendar className="h-3 w-3 text-muted-foreground" /><span>{formatYmd(detail.sheetYmd, "weekday-long")}</span></div>
        <div className="flex items-center gap-2"><Users className="h-3 w-3 text-muted-foreground" /><span>{detail.crewName}</span></div>
        {detail.supervisorName && <div className="flex items-center gap-2"><User className="h-3 w-3 text-muted-foreground" /><span>{detail.supervisorName}</span></div>}
        {(detail.startTime || detail.endTime) && <div className="flex items-center gap-2"><Clock className="h-3 w-3 text-muted-foreground" /><span>{detail.startTime || "—"} - {detail.endTime || "—"}</span></div>}
      </div>
    </div>
  );
}

function WorkerRatingsSection({ workerId, ratingsEnabled }: { workerId: string; ratingsEnabled: boolean }) {
  const { data: ratings = [], isLoading } = useQuery<WorkerRatingWithType[]>({
    queryKey: ["/api/worker-ratings/worker", workerId],
    queryFn: async () => {
      const response = await fetch(`/api/worker-ratings/worker/${workerId}`);
      if (!response.ok) throw new Error("Failed to fetch worker ratings");
      return response.json();
    },
    enabled: ratingsEnabled,
  });
  if (!ratingsEnabled) return null;
  if (isLoading) return <div className="border-t pt-3 space-y-2"><div className="text-sm font-medium text-muted-foreground">Ratings</div><Skeleton className="h-16 w-full" /></div>;
  if (!ratings.length) return <div className="border-t pt-3"><div className="text-sm font-medium text-muted-foreground">Ratings</div><div className="text-sm text-muted-foreground mt-1">No ratings assigned</div></div>;
  return (
    <div className="border-t pt-3">
      <div className="text-sm font-medium text-muted-foreground mb-2">Ratings</div>
      <div className="grid grid-cols-2 gap-2">{ratings.map((rating) => <div key={rating.id} className="flex items-center justify-between bg-muted/50 rounded-md px-2 py-1.5"><span className="text-sm truncate mr-2">{rating.ratingType?.name ?? "Unknown rating"}</span><div className="flex items-center gap-0.5 flex-shrink-0">{[0, 1, 2, 3].map((i) => <Star key={i} className={`h-3 w-3 ${i < rating.value ? "text-yellow-400" : "text-muted-foreground/30"}`} fill={i < rating.value ? "currentColor" : "none"} />)}</div></div>)}</div>
    </div>
  );
}