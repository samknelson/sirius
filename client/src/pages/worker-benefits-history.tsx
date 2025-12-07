import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrustWmb, TrustBenefit, Employer } from "@shared/schema";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface WorkerBenefit extends TrustWmb {
  benefit: TrustBenefit;
  employer: Employer;
}

function WorkerBenefitsContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedBenefitId, setSelectedBenefitId] = useState<string>("");
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>("");

  // Fetch worker benefits
  const { data: benefits = [], isLoading } = useQuery<WorkerBenefit[]>({
    queryKey: ["/api/workers", worker.id, "benefits"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/benefits`);
      if (!response.ok) {
        throw new Error("Failed to fetch worker benefits");
      }
      return response.json();
    },
  });

  // Fetch all available benefits
  const { data: allBenefits = [] } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
    queryFn: async () => {
      const response = await fetch("/api/trust-benefits");
      if (!response.ok) {
        throw new Error("Failed to fetch benefits");
      }
      return response.json();
    },
  });

  // Fetch all employers
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
    queryFn: async () => {
      const response = await fetch("/api/employers");
      if (!response.ok) {
        throw new Error("Failed to fetch employers");
      }
      return response.json();
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: { month: number; year: number; employerId: string; benefitId: string }) => {
      const response = await fetch(`/api/workers/${worker.id}/benefits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create benefit entry");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "benefits"] });
      toast({ title: "Success", description: "Benefit entry created successfully" });
      setIsAddDialogOpen(false);
      setSelectedYear("");
      setSelectedMonth("");
      setSelectedBenefitId("");
      setSelectedEmployerId("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create benefit entry",
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/worker-benefits/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete benefit entry");
      }
      return response.status === 204 ? null : response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "benefits"] });
      toast({ title: "Success", description: "Benefit entry deleted successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete benefit entry",
        variant: "destructive",
      });
    },
  });

  const handleCreate = () => {
    if (!selectedYear || !selectedMonth || !selectedBenefitId || !selectedEmployerId) {
      toast({
        title: "Validation Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      year: parseInt(selectedYear),
      month: parseInt(selectedMonth),
      benefitId: selectedBenefitId,
      employerId: selectedEmployerId,
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this benefit entry?")) {
      deleteMutation.mutate(id);
    }
  };

  // Generate year options (current year + 5 years back)
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

  const getMonthName = (month: number) => {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return monthNames[month - 1];
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Benefit History</CardTitle>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-benefit">
                <Plus size={16} className="mr-2" />
                Add Benefit Entry
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-add-benefit">
              <DialogHeader>
                <DialogTitle>Add Benefit Entry</DialogTitle>
                <DialogDescription>
                  Record a new benefit for this worker
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="year">Year</Label>
                  <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger id="year" data-testid="select-year">
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
                <div>
                  <Label htmlFor="month">Month</Label>
                  <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                    <SelectTrigger id="month" data-testid="select-month">
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
                <div>
                  <Label htmlFor="employer">Employer</Label>
                  <Select value={selectedEmployerId} onValueChange={setSelectedEmployerId}>
                    <SelectTrigger id="employer" data-testid="select-employer">
                      <SelectValue placeholder="Select employer" />
                    </SelectTrigger>
                    <SelectContent>
                      {employers.filter(e => e.isActive).map((employer) => (
                        <SelectItem key={employer.id} value={employer.id}>
                          {employer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="benefit">Benefit</Label>
                  <Select value={selectedBenefitId} onValueChange={setSelectedBenefitId}>
                    <SelectTrigger id="benefit" data-testid="select-benefit">
                      <SelectValue placeholder="Select benefit" />
                    </SelectTrigger>
                    <SelectContent>
                      {allBenefits.filter(b => b.isActive).map((benefit) => (
                        <SelectItem key={benefit.id} value={benefit.id}>
                          {benefit.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsAddDialogOpen(false)}
                  data-testid="button-cancel-add"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  data-testid="button-save-benefit"
                >
                  {createMutation.isPending ? "Creating..." : "Create Entry"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading benefits...</div>
        ) : benefits.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-benefits">
            No benefit entries recorded for this worker
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Month</TableHead>
                <TableHead>Benefit</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {benefits.map((benefit) => (
                <TableRow key={benefit.id} data-testid={`row-benefit-${benefit.id}`}>
                  <TableCell>{benefit.year}</TableCell>
                  <TableCell>{getMonthName(benefit.month)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{benefit.benefit.name}</Badge>
                  </TableCell>
                  <TableCell>{benefit.employer.name}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(benefit.id)}
                      data-testid={`button-delete-benefit-${benefit.id}`}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerBenefitsHistory() {
  return (
    <WorkerLayout activeTab="benefits-history">
      <WorkerBenefitsContent />
    </WorkerLayout>
  );
}
