import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  benefitOptions,
  employerOptions,
  illustrativeBenefitHistory,
  type BenefitHistoryRecord,
} from "./_data";
import "./_group.css";

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

const getMonthName = (month: number) => months[month - 1]?.label ?? "";

export function Current() {
  const [benefits, setBenefits] = useState(illustrativeBenefitHistory);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedBenefitId, setSelectedBenefitId] = useState("");
  const [selectedEmployerId, setSelectedEmployerId] = useState("");

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const handleCreate = () => {
    if (!selectedYear || !selectedMonth || !selectedBenefitId || !selectedEmployerId) return;

    const benefit = benefitOptions.find((option) => option.id === selectedBenefitId);
    const employer = employerOptions.find((option) => option.id === selectedEmployerId);
    if (!benefit || !employer) return;

    const record: BenefitHistoryRecord = {
      id: `local-${Date.now()}`,
      year: Number(selectedYear),
      month: Number(selectedMonth),
      benefit,
      employer,
      sourceRelationId: null,
      sourceRelation: null,
    };
    setBenefits((current) =>
      [...current, record].sort((a, b) => b.year - a.year || b.month - a.month),
    );
    setIsAddDialogOpen(false);
    setSelectedYear("");
    setSelectedMonth("");
    setSelectedBenefitId("");
    setSelectedEmployerId("");
  };

  const handleDelete = (id: string) => {
    setBenefits((current) => current.filter((benefit) => benefit.id !== id));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
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
                        {employerOptions.map((employer) => (
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
                        {benefitOptions.map((benefit) => (
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
                    disabled={!selectedYear || !selectedMonth || !selectedBenefitId || !selectedEmployerId}
                    data-testid="button-save-benefit"
                  >
                    Create Entry
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {benefits.length === 0 ? (
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
                  <TableHead>Source</TableHead>
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
                    <TableCell data-testid={`text-benefit-source-${benefit.id}`}>
                      {benefit.sourceRelationId ? (
                        <span className="text-muted-foreground">
                          via{" "}
                          {benefit.sourceRelation?.sourceWorkerName ?? "Unknown worker"}
                          {benefit.sourceRelation?.relationTypeName
                            ? ` (${benefit.sourceRelation.relationTypeName})`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Own</span>
                      )}
                    </TableCell>
                    <TableCell>{benefit.employer.name}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(benefit.id)}
                        aria-label={`Delete ${benefit.benefit.name} benefit entry for ${getMonthName(benefit.month)} ${benefit.year}`}
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
    </div>
  );
}