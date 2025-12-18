import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import EventLayout, { useEventLayout } from "@/components/layouts/EventLayout";

function EventViewContent() {
  const { event } = useEventLayout();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default">Active</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Event Details</CardTitle>
          <CardDescription>View event information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Title</label>
              <p className="text-foreground" data-testid="text-event-title">{event.title}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Record ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-event-id">{event.id}</p>
            </div>
          </div>
          {event.description && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <p className="text-foreground" data-testid="text-event-description">{event.description}</p>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Created</label>
            <p className="text-foreground" data-testid="text-event-created">
              {format(new Date(event.createdAt), "MMMM d, yyyy 'at' h:mm a")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Occurrences</CardTitle>
          <CardDescription>
            {event.occurrences?.length || 0} occurrence{(event.occurrences?.length || 0) !== 1 ? "s" : ""} scheduled
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!event.occurrences || event.occurrences.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-no-occurrences">
              No occurrences scheduled yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {event.occurrences.map((occ) => (
                  <TableRow key={occ.id} data-testid={`row-occurrence-${occ.id}`}>
                    <TableCell data-testid={`text-occ-date-${occ.id}`}>
                      {format(new Date(occ.startAt), "EEEE, MMMM d, yyyy")}
                    </TableCell>
                    <TableCell data-testid={`text-occ-time-${occ.id}`}>
                      {format(new Date(occ.startAt), "h:mm a")}
                      {occ.endAt && (
                        <> - {format(new Date(occ.endAt), "h:mm a")}</>
                      )}
                    </TableCell>
                    <TableCell data-testid={`badge-occ-status-${occ.id}`}>
                      {getStatusBadge(occ.status)}
                    </TableCell>
                    <TableCell data-testid={`text-occ-notes-${occ.id}`}>
                      {occ.notes || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EventViewPage() {
  return (
    <EventLayout activeTab="view">
      <EventViewContent />
    </EventLayout>
  );
}
