import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, addDays, startOfDay } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Plus, FileSpreadsheet, Building2, Calendar, Users, CalendarDays } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { EdlsSheetForm, type SheetFormData } from "@/components/edls/EdlsSheetForm";
import type { EdlsSheet } from "@shared/schema";
import { cn } from "@/lib/utils";

interface EdlsSheetWithRelations extends EdlsSheet {
  employer?: { id: string; name: string };
}

interface PaginatedEdlsSheets {
  data: EdlsSheetWithRelations[];
  total: number;
  page: number;
  limit: number;
}

type DateFilterType = "all" | "today" | "tomorrow" | "day2" | "day3" | "day4" | "day5" | "day6" | "other" | "range";

function getDateFilterOptions(): Array<{ value: DateFilterType; label: string; date?: Date }> {
  const today = startOfDay(new Date());
  const options: Array<{ value: DateFilterType; label: string; date?: Date }> = [
    { value: "all", label: "All Dates" },
    { value: "today", label: "Today", date: today },
    { value: "tomorrow", label: "Tomorrow", date: addDays(today, 1) },
  ];
  
  for (let i = 2; i <= 6; i++) {
    const date = addDays(today, i);
    options.push({
      value: `day${i}` as DateFilterType,
      label: `${format(date, "EEEE")} (${format(date, "d MMMM")})`,
      date,
    });
  }
  
  options.push(
    { value: "other", label: "Other Date" },
    { value: "range", label: "Date Range" }
  );
  
  return options;
}

export default function EdlsSheetsPage() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [dateFilterType, setDateFilterType] = useState<DateFilterType>("all");
  const [otherDate, setOtherDate] = useState<Date | undefined>(undefined);
  const [rangeFromDate, setRangeFromDate] = useState<Date | undefined>(undefined);
  const [rangeToDate, setRangeToDate] = useState<Date | undefined>(undefined);
  
  const dateFilterOptions = useMemo(() => getDateFilterOptions(), []);
  
  const { dateFrom, dateTo } = useMemo(() => {
    if (dateFilterType === "all") {
      return { dateFrom: undefined, dateTo: undefined };
    }
    if (dateFilterType === "other" && otherDate) {
      const dateStr = format(otherDate, "yyyy-MM-dd");
      return { dateFrom: dateStr, dateTo: dateStr };
    }
    if (dateFilterType === "range") {
      return {
        dateFrom: rangeFromDate ? format(rangeFromDate, "yyyy-MM-dd") : undefined,
        dateTo: rangeToDate ? format(rangeToDate, "yyyy-MM-dd") : undefined,
      };
    }
    const option = dateFilterOptions.find(o => o.value === dateFilterType);
    if (option?.date) {
      const dateStr = format(option.date, "yyyy-MM-dd");
      return { dateFrom: dateStr, dateTo: dateStr };
    }
    return { dateFrom: undefined, dateTo: undefined };
  }, [dateFilterType, otherDate, rangeFromDate, rangeToDate, dateFilterOptions]);
  
  const queryParams = new URLSearchParams();
  if (dateFrom) queryParams.set("dateFrom", dateFrom);
  if (dateTo) queryParams.set("dateTo", dateTo);
  const queryString = queryParams.toString();
  
  const { data: sheetsData, isLoading } = useQuery<PaginatedEdlsSheets>({
    queryKey: ["/api/edls/sheets", { dateFrom, dateTo }],
    queryFn: async () => {
      const url = queryString ? `/api/edls/sheets?${queryString}` : "/api/edls/sheets";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sheets");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: SheetFormData) => {
      return apiRequest("POST", "/api/edls/sheets", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets"] });
      setIsCreateDialogOpen(false);
      toast({
        title: "Sheet Created",
        description: "The new sheet has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create sheet",
        variant: "destructive",
      });
    },
  });

  const handleCreateSheet = (data: SheetFormData) => {
    createMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const sheets = sheetsData?.data || [];

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <div>
            <CardTitle data-testid="title-page" className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Day Labor Sheets
            </CardTitle>
            <CardDescription>
              Manage employer day labor scheduling sheets
            </CardDescription>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-sheet">
                <Plus className="h-4 w-4 mr-2" />
                New Sheet
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Sheet</DialogTitle>
                <DialogDescription>
                  Add a new day labor scheduling sheet for an employer.
                </DialogDescription>
              </DialogHeader>
              <EdlsSheetForm
                onSubmit={handleCreateSheet}
                onCancel={() => setIsCreateDialogOpen(false)}
                isSubmitting={createMutation.isPending}
                submitLabel="Create Sheet"
              />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                Date Filter
              </label>
              <Select 
                value={dateFilterType} 
                onValueChange={(value) => setDateFilterType(value as DateFilterType)}
              >
                <SelectTrigger className="w-[220px]" data-testid="select-date-filter">
                  <SelectValue placeholder="Select date filter" />
                </SelectTrigger>
                <SelectContent>
                  {dateFilterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} data-testid={`option-date-${option.value}`}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {dateFilterType === "other" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-muted-foreground">Select Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-[200px] justify-start text-left font-normal",
                        !otherDate && "text-muted-foreground"
                      )}
                      data-testid="button-other-date"
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {otherDate ? format(otherDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={otherDate}
                      onSelect={setOtherDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
            
            {dateFilterType === "range" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-muted-foreground">From</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[200px] justify-start text-left font-normal",
                          !rangeFromDate && "text-muted-foreground"
                        )}
                        data-testid="button-date-from"
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        {rangeFromDate ? format(rangeFromDate, "PPP") : "Start date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={rangeFromDate}
                        onSelect={setRangeFromDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-muted-foreground">To</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[200px] justify-start text-left font-normal",
                          !rangeToDate && "text-muted-foreground"
                        )}
                        data-testid="button-date-to"
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        {rangeToDate ? format(rangeToDate, "PPP") : "End date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={rangeToDate}
                        onSelect={setRangeToDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </>
            )}
          </div>
          
          {sheets.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No sheets found.</p>
              <p className="text-sm">{dateFilterType !== "all" ? "Try adjusting your date filter or create a new sheet." : "Create a new sheet to get started."}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Employer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Workers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheets.map((sheet) => (
                  <TableRow key={sheet.id} data-testid={`row-sheet-${sheet.id}`}>
                    <TableCell>
                      <Link href={`/edls/sheet/${sheet.id}`}>
                        <Button
                          variant="link"
                          className="p-0 h-auto font-medium"
                          data-testid={`link-sheet-${sheet.id}`}
                        >
                          <FileSpreadsheet className="h-4 w-4 mr-2 text-muted-foreground" />
                          {sheet.title}
                        </Button>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {sheet.employer?.name || "Unknown"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {format(new Date(sheet.date), "PPP")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {sheet.workerCount}
                      </div>
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
