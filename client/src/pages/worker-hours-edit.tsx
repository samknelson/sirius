import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { WorkerHoursLayout, useWorkerHoursLayout } from "@/components/layouts/WorkerHoursLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { Employer } from "@shared/schema";

interface EmploymentStatus {
  id: string;
  name: string;
  code: string;
  employed: boolean;
  description: string | null;
}

interface LedgerNotification {
  type: "created" | "updated" | "deleted";
  amount: string;
  description: string;
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

function WorkerHoursEditContent() {
  const { hoursEntry } = useWorkerHoursLayout();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [selectedYear, setSelectedYear] = useState<string>(hoursEntry.year.toString());
  const [selectedMonth, setSelectedMonth] = useState<string>(hoursEntry.month.toString());
  const [selectedDay, setSelectedDay] = useState<string>(hoursEntry.day.toString());
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>(hoursEntry.employerId);
  const [selectedEmploymentStatusId, setSelectedEmploymentStatusId] = useState<string>(hoursEntry.employmentStatusId);
  const [selectedHours, setSelectedHours] = useState<string>(hoursEntry.hours?.toString() || "");
  const [selectedHome, setSelectedHome] = useState<boolean>(hoursEntry.home);

  const showLedgerNotifications = (notifications: LedgerNotification[] | undefined) => {
    if (!notifications || notifications.length === 0) return;
    
    for (const notification of notifications) {
      const typeLabel = notification.type === "created" ? "Ledger Entry Created" :
                        notification.type === "updated" ? "Ledger Entry Updated" :
                        "Ledger Entry Deleted";
      
      toast({
        title: typeLabel,
        description: `${formatCurrency(notification.amount)} - ${notification.description}`,
      });
    }
  };

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: employmentStatuses = [] } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/employment-statuses"],
  });

  useEffect(() => {
    setSelectedYear(hoursEntry.year.toString());
    setSelectedMonth(hoursEntry.month.toString());
    setSelectedDay(hoursEntry.day.toString());
    setSelectedEmployerId(hoursEntry.employerId);
    setSelectedEmploymentStatusId(hoursEntry.employmentStatusId);
    setSelectedHours(hoursEntry.hours?.toString() || "");
    setSelectedHome(hoursEntry.home);
  }, [hoursEntry]);

  const updateMutation = useMutation({
    mutationFn: async (data: { year: number; month: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home: boolean }) => {
      const response = await fetch(`/api/worker-hours/${hoursEntry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update hours entry");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-hours", hoursEntry.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers", hoursEntry.workerId, "hours"] });
      toast({ title: "Success", description: "Hours entry updated successfully" });
      showLedgerNotifications(data.ledgerNotifications);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update hours entry",
        variant: "destructive",
      });
    },
  });

  const handleUpdate = () => {
    if (!selectedYear || !selectedMonth || !selectedDay || !selectedEmployerId || !selectedEmploymentStatusId) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      year: parseInt(selectedYear),
      month: parseInt(selectedMonth),
      day: parseInt(selectedDay),
      employerId: selectedEmployerId,
      employmentStatusId: selectedEmploymentStatusId,
      hours: selectedHours ? parseFloat(selectedHours) : null,
      home: selectedHome,
    });
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const months = [
    { value: "1", label: "January" },
    { value: "2", label: "February" },
    { value: "3", label: "March" },
    { value: "4", label: "April" },
    { value: "5", label: "May" },
    { value: "6", label: "June" },
    { value: "7", label: "July" },
    { value: "8", label: "August" },
    { value: "9", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];

  const getDaysInMonth = () => {
    if (!selectedYear || !selectedMonth) return [];
    const year = parseInt(selectedYear);
    const month = parseInt(selectedMonth);
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  };

  const validDays = getDaysInMonth();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit Hours Entry</CardTitle>
        <CardDescription>Update hours entry details</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="year">Year *</Label>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger id="year" data-testid="select-edit-year">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="month">Month *</Label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger id="month" data-testid="select-edit-month">
                <SelectValue placeholder="Select month" />
              </SelectTrigger>
              <SelectContent>
                {months.map((month) => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="day">Day *</Label>
            <Select value={selectedDay} onValueChange={setSelectedDay} disabled={!selectedYear || !selectedMonth}>
              <SelectTrigger id="day" data-testid="select-edit-day">
                <SelectValue placeholder={validDays.length > 0 ? "Select day" : "Select year and month first"} />
              </SelectTrigger>
              <SelectContent>
                {validDays.map((day) => (
                  <SelectItem key={day} value={day.toString()}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="employer">Employer *</Label>
            <Select value={selectedEmployerId} onValueChange={setSelectedEmployerId}>
              <SelectTrigger id="employer" data-testid="select-edit-employer">
                <SelectValue placeholder="Select employer" />
              </SelectTrigger>
              <SelectContent>
                {employers.map((employer) => (
                  <SelectItem key={employer.id} value={employer.id}>
                    {employer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="employment-status">Employment Status *</Label>
            <Select value={selectedEmploymentStatusId} onValueChange={setSelectedEmploymentStatusId}>
              <SelectTrigger id="employment-status" data-testid="select-edit-employment-status">
                <SelectValue placeholder="Select employment status" />
              </SelectTrigger>
              <SelectContent>
                {employmentStatuses.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hours">Hours</Label>
            <Input
              id="hours"
              type="number"
              step="0.01"
              placeholder="Enter hours"
              value={selectedHours}
              onChange={(e) => setSelectedHours(e.target.value)}
              data-testid="input-edit-hours"
            />
          </div>
        </div>

        <div className="flex items-center justify-between max-w-xs">
          <Label htmlFor="home">Home</Label>
          <Switch
            id="home"
            checked={selectedHome}
            onCheckedChange={setSelectedHome}
            data-testid="switch-edit-home"
          />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button 
            onClick={handleUpdate} 
            disabled={updateMutation.isPending}
            data-testid="button-save-hours"
          >
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkerHoursEdit() {
  return (
    <WorkerHoursLayout activeTab="edit">
      <WorkerHoursEditContent />
    </WorkerHoursLayout>
  );
}
