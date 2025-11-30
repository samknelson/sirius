import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  MessageSquare, 
  ArrowUpDown, 
  Filter, 
  X,
  CheckCircle2,
  Clock,
  AlertCircle,
  Send,
  Inbox,
  Phone,
  Mail,
  Eye
} from "lucide-react";
import { format } from "date-fns";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";

interface CommSmsDetails {
  id: string;
  commId: string;
  to: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
}

interface CommEmailDetails {
  id: string;
  commId: string;
  to: string | null;
  toName: string | null;
  from: string | null;
  fromName: string | null;
  replyTo: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  data: Record<string, unknown> | null;
}

interface CommPostalDetails {
  id: string;
  commId: string;
  toName: string | null;
  toAddressLine1: string | null;
  toAddressLine2: string | null;
  toCity: string | null;
  toState: string | null;
  toZip: string | null;
  toCountry: string | null;
  fromName: string | null;
  fromAddressLine1: string | null;
  fromAddressLine2: string | null;
  fromCity: string | null;
  fromState: string | null;
  fromZip: string | null;
  fromCountry: string | null;
  description: string | null;
  mailType: string | null;
  data: Record<string, unknown> | null;
}

interface CommWithDetails {
  id: string;
  medium: string;
  contactId: string;
  status: string;
  sent: string | null;
  received: string | null;
  data: Record<string, unknown> | null;
  smsDetails?: CommSmsDetails | null;
  emailDetails?: CommEmailDetails | null;
  postalDetails?: CommPostalDetails | null;
}

type SortField = "sent" | "medium" | "status";
type SortDirection = "asc" | "desc";

interface CommListProps {
  records: CommWithDetails[];
  isLoading?: boolean;
  title?: string;
  emptyMessage?: string;
}

export function CommList({ 
  records, 
  isLoading = false, 
  title = "Communication History",
  emptyMessage = "No communication history found."
}: CommListProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [filterMedium, setFilterMedium] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("sent");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filteredAndSortedRecords = useMemo(() => {
    if (!records) return [];

    let result = [...records];

    if (filterMedium !== "all") {
      result = result.filter(r => r.medium === filterMedium);
    }

    if (filterStatus !== "all") {
      result = result.filter(r => r.status === filterStatus);
    }

    if (filterDateFrom) {
      const from = new Date(filterDateFrom);
      result = result.filter(r => r.sent && new Date(r.sent) >= from);
    }

    if (filterDateTo) {
      const to = new Date(filterDateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(r => r.sent && new Date(r.sent) <= to);
    }

    result.sort((a, b) => {
      let aValue: string | number | null;
      let bValue: string | number | null;

      if (sortField === "sent") {
        aValue = a.sent ? new Date(a.sent).getTime() : null;
        bValue = b.sent ? new Date(b.sent).getTime() : null;
      } else if (sortField === "medium") {
        aValue = a.medium;
        bValue = b.medium;
      } else if (sortField === "status") {
        aValue = a.status;
        bValue = b.status;
      } else {
        return 0;
      }

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDirection === "asc" 
          ? aValue.localeCompare(bValue) 
          : bValue.localeCompare(aValue);
      }

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      if (aValue === null && bValue !== null) return 1;
      if (aValue !== null && bValue === null) return -1;
      
      return 0;
    });

    return result;
  }, [records, filterMedium, filterStatus, filterDateFrom, filterDateTo, sortField, sortDirection]);

  const mediumTypes = useMemo(() => {
    if (!records) return [];
    const types = new Set(records.map(r => r.medium));
    return Array.from(types).sort();
  }, [records]);

  const statusTypes = useMemo(() => {
    if (!records) return [];
    const types = new Set(records.map(r => r.status));
    return Array.from(types).sort();
  }, [records]);

  const clearFilters = () => {
    setFilterMedium("all");
    setFilterStatus("all");
    setFilterDateFrom("");
    setFilterDateTo("");
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const hasActiveFilters = 
    filterMedium !== "all" ||
    filterStatus !== "all" ||
    filterDateFrom !== "" ||
    filterDateTo !== "";

  const getMediumIcon = (medium: string) => {
    switch (medium.toLowerCase()) {
      case "sms":
        return <MessageSquare className="h-4 w-4" />;
      case "phone":
        return <Phone className="h-4 w-4" />;
      case "email":
        return <Mail className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "queued":
      case "sending":
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3 animate-pulse" />
            Sending
          </Badge>
        );
      case "sent":
        return (
          <Badge variant="outline" className="gap-1">
            <Send className="h-3 w-3" />
            Sent
          </Badge>
        );
      case "delivered":
        return (
          <Badge variant="default" className="gap-1 bg-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Delivered
          </Badge>
        );
      case "received":
        return (
          <Badge variant="secondary" className="gap-1">
            <Inbox className="h-3 w-3" />
            Received
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      case "undelivered":
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy h:mm a");
    } catch {
      return "-";
    }
  };

  const truncateBody = (body: string | null, maxLength: number = 50) => {
    if (!body) return "-";
    if (body.length <= maxLength) return body;
    return body.substring(0, maxLength) + "...";
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            Loading communication history...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          {title}
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" data-testid="text-comm-count">
            {filteredAndSortedRecords.length} record(s)
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-comm-filters"
          >
            <Filter className="h-4 w-4 mr-2" />
            {showFilters ? "Hide" : "Show"} Filters
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-md">
            <div className="space-y-2">
              <Label>Medium</Label>
              <Select value={filterMedium} onValueChange={setFilterMedium}>
                <SelectTrigger data-testid="select-comm-medium-filter">
                  <SelectValue placeholder="All mediums" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All mediums</SelectItem>
                  {mediumTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger data-testid="select-comm-status-filter">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {statusTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>From Date</Label>
              <Input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                data-testid="input-comm-date-from"
              />
            </div>

            <div className="space-y-2">
              <Label>To Date</Label>
              <Input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                data-testid="input-comm-date-to"
              />
            </div>

            {hasActiveFilters && (
              <div className="col-span-full flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  data-testid="button-clear-comm-filters"
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear Filters
                </Button>
              </div>
            )}
          </div>
        )}

        {filteredAndSortedRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
            <MessageSquare className="h-8 w-8" />
            <p>{emptyMessage}</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSort("medium")}
                      className="flex items-center gap-1 -ml-4"
                      data-testid="button-sort-comm-medium"
                    >
                      Medium
                      <ArrowUpDown className="h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSort("status")}
                      className="flex items-center gap-1 -ml-4"
                      data-testid="button-sort-comm-status"
                    >
                      Status
                      <ArrowUpDown className="h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSort("sent")}
                      className="flex items-center gap-1 -ml-4"
                      data-testid="button-sort-comm-sent"
                    >
                      Sent
                      <ArrowUpDown className="h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSortedRecords.map((record) => (
                  <TableRow key={record.id} data-testid={`row-comm-${record.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getMediumIcon(record.medium)}
                        <span className="capitalize">{record.medium}</span>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(record.status)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(record.sent)}
                    </TableCell>
                    <TableCell>
                      {record.medium === 'sms' && record.smsDetails?.to 
                        ? formatPhoneNumberForDisplay(record.smsDetails.to)
                        : record.medium === 'email' && record.emailDetails?.to
                          ? record.emailDetails.to
                          : record.medium === 'postal' && record.postalDetails
                            ? `${record.postalDetails.toName || ''} - ${record.postalDetails.toCity || ''}, ${record.postalDetails.toState || ''}`.replace(/^[\s-]+|[\s-]+$/g, '') || "-"
                            : "-"}
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <span className="text-sm text-muted-foreground">
                        {record.medium === 'email' && record.emailDetails?.subject
                          ? truncateBody(record.emailDetails.subject)
                          : record.medium === 'postal' && record.postalDetails?.description
                            ? truncateBody(record.postalDetails.description)
                            : truncateBody(record.smsDetails?.body || null)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        data-testid={`button-view-comm-${record.id}`}
                      >
                        <Link href={`/comm/${record.id}`}>
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
