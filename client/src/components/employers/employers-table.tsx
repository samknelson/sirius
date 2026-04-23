import { useState, useMemo, useEffect } from "react";
import { ArrowUpDown, Building2, Eye, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Employer, TrustBenefit } from "@shared/schema";
import { Company } from "@shared/schema/employer/company-schema";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { renderIcon } from "@/components/ui/icon-picker";

type EmployerWithCompany = Employer & { companyId?: string | null; companyName?: string | null };
type BenefitWithIcon = TrustBenefit & { benefitTypeIcon?: string | null };

interface EmployersTableProps {
  employers: EmployerWithCompany[];
  isLoading: boolean;
  includeInactive: boolean;
  onToggleInactive: () => void;
  showCompany?: boolean;
  companies?: Company[];
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  workerCounts?: Record<string, number>;
  benefitCounts?: Record<string, Record<string, number>>;
  countsLoading?: boolean;
  showBenefits?: boolean;
  benefits?: BenefitWithIcon[];
}

const avatarColors = [
  "bg-primary/10 text-primary",
  "bg-accent/10 text-accent", 
  "bg-yellow-100 text-yellow-600",
  "bg-purple-100 text-purple-600",
  "bg-red-100 text-red-600",
];

interface EmployerType {
  id: string;
  name: string;
  data?: { icon?: string } | null;
}

export function EmployersTable({ employers, isLoading, includeInactive, onToggleInactive, showCompany, companies = [], selectable = false, selectedIds, onSelectionChange, workerCounts, benefitCounts, countsLoading = false, showBenefits = false, benefits = [] }: EmployersTableProps) {
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");

  // Fetch employer types for icons
  const { data: employerTypes = [] } = useQuery<EmployerType[]>({
    queryKey: ["/api/employer-types"],
  });

  // Create map for employer type info (icon and name)
  const employerTypeMap = useMemo(() => {
    const map = new Map<string, { icon: string; name: string }>();
    for (const type of employerTypes) {
      const iconName = type.data?.icon || "Building";
      map.set(type.id, { icon: iconName, name: type.name });
    }
    return map;
  }, [employerTypes]);

  // Filter employers based on search query and type
  const filteredEmployers = useMemo(() => {
    return employers.filter(employer => {
      // Filter by employer type
      if (selectedTypeId !== "all" && employer.typeId !== selectedTypeId) {
        return false;
      }
      
      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const id = employer.id.toLowerCase();
        const name = employer.name.toLowerCase();
        const siriusId = String(employer.siriusId);
        
        if (!id.includes(query) && !name.includes(query) && !siriusId.includes(query)) {
          return false;
        }
      }
      
      // Filter by company
      if (showCompany && companyFilter !== "all") {
        if (companyFilter === "none") {
          if (employer.companyId) return false;
        } else {
          if (employer.companyId !== companyFilter) return false;
        }
      }

      return true;
    });
  }, [employers, searchQuery, selectedTypeId, showCompany, companyFilter]);

  const sortedEmployers = [...filteredEmployers].sort((a, b) => {
    if (sortOrder === "asc") {
      return a.name.localeCompare(b.name);
    }
    return b.name.localeCompare(a.name);
  });

  // Prune selection to currently visible (filtered) rows whenever the visible set changes.
  const visibleIdsKey = sortedEmployers.map((e) => e.id).join(",");
  useEffect(() => {
    if (!selectable || !selectedIds || !onSelectionChange) return;
    if (selectedIds.size === 0) return;
    const visible = new Set(sortedEmployers.map((e) => e.id));
    let changed = false;
    const pruned = new Set<string>();
    selectedIds.forEach((id) => {
      if (visible.has(id)) {
        pruned.add(id);
      } else {
        changed = true;
      }
    });
    if (changed) {
      onSelectionChange(pruned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIdsKey, selectable]);

  const toggleSort = () => {
    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
  };

  if (isLoading) {
    return (
      <Card className="shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <Skeleton className="h-6 w-48" />
        </div>
        <CardContent className="p-0">
          <div className="space-y-4 p-6">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Employers Database</h2>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <ArrowUpDown className="text-muted-foreground" size={16} />
                <span className="text-sm text-muted-foreground">Sort by Name</span>
              </div>
              <span className="text-sm font-medium text-primary" data-testid="text-total-employers">
                {filteredEmployers.length} of {employers.length}
              </span>
            </div>
          </div>
          
          {/* Search Input */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={16} />
            <Input
              type="text"
              placeholder="Search by Record ID or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-employers"
            />
          </div>
          
          {/* Filters Row */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Include Inactive Toggle */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-inactive"
                checked={includeInactive}
                onCheckedChange={onToggleInactive}
                data-testid="checkbox-include-inactive"
              />
              <Label
                htmlFor="include-inactive"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Include inactive employers
              </Label>
            </div>
            
            {/* Employer Type Filter */}
            <div className="flex items-center gap-2">
              <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
                <SelectTrigger className="w-[180px]" data-testid="select-employer-type-filter">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {employerTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      <div className="flex items-center gap-2">
                        {renderIcon(type.data?.icon || "Building2", "w-4 h-4")}
                        <span>{type.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Company Filter */}
            {showCompany && (
              <div className="flex items-center space-x-2">
                <Label className="text-sm text-muted-foreground whitespace-nowrap">Company:</Label>
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="w-[200px] h-8 text-sm" data-testid="select-company-filter">
                    <SelectValue placeholder="All companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="select-company-all">All</SelectItem>
                    <SelectItem value="none" data-testid="select-company-none">No company</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id} data-testid={`select-company-${c.id}`}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/20">
              <tr>
                {selectable && (
                  <th className="px-6 py-3 text-left w-10">
                    <Checkbox
                      checked={
                        sortedEmployers.length > 0 &&
                        sortedEmployers.every((e) => selectedIds?.has(e.id))
                      }
                      onCheckedChange={(checked) => {
                        if (!onSelectionChange) return;
                        const next = new Set(selectedIds ?? []);
                        if (checked) {
                          sortedEmployers.forEach((e) => next.add(e.id));
                        } else {
                          sortedEmployers.forEach((e) => next.delete(e.id));
                        }
                        onSelectionChange(next);
                      }}
                      data-testid="checkbox-select-all-employers"
                      aria-label="Select all visible employers"
                    />
                  </th>
                )}
                {showCompany && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <span>Company</span>
                  </th>
                )}
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors"
                  onClick={toggleSort}
                  data-testid="button-sort-name"
                >
                  <div className="flex items-center space-x-2">
                    <span>Employer Name</span>
                    <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Status</span>
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  <span>Workers</span>
                </th>
                {showBenefits && benefits.map((b) => (
                  <th
                    key={b.id}
                    className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                    data-testid={`th-benefit-${b.id}`}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex justify-end" aria-label={b.name}>
                          {b.benefitTypeIcon
                            ? renderIcon(b.benefitTypeIcon, "w-4 h-4 inline-block")
                            : <span>{b.name}</span>}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{b.name}</TooltipContent>
                    </Tooltip>
                  </th>
                ))}
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {sortedEmployers.map((employer, index) => (
                <tr key={employer.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-employer-${employer.id}`}>
                  {selectable && (
                    <td className="px-6 py-4 whitespace-nowrap w-10">
                      <Checkbox
                        checked={selectedIds?.has(employer.id) ?? false}
                        onCheckedChange={(checked) => {
                          if (!onSelectionChange) return;
                          const next = new Set(selectedIds ?? []);
                          if (checked) {
                            next.add(employer.id);
                          } else {
                            next.delete(employer.id);
                          }
                          onSelectionChange(next);
                        }}
                        data-testid={`checkbox-select-employer-${employer.id}`}
                        aria-label={`Select ${employer.name}`}
                      />
                    </td>
                  )}
                  {showCompany && (
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className="text-sm text-muted-foreground"
                        data-testid={`text-employer-company-${employer.id}`}
                      >
                        {employer.companyName || ""}
                      </span>
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className="text-sm font-medium text-foreground"
                      data-testid={`text-employer-name-${employer.id}`}
                    >
                      {employer.name}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span 
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        employer.isActive 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                      }`}
                      data-testid={`status-employer-${employer.id}`}
                    >
                      {employer.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm" data-testid={`text-employer-worker-count-${employer.id}`}>
                    {countsLoading && !workerCounts ? (
                      <Skeleton className="h-4 w-8 ml-auto" />
                    ) : (workerCounts?.[employer.id] ?? 0) > 0 ? (
                      <span className="font-medium tabular-nums">{workerCounts?.[employer.id]}</span>
                    ) : (
                      <span className="text-muted-foreground tabular-nums">0</span>
                    )}
                  </td>
                  {showBenefits && benefits.map((b) => {
                    const count = benefitCounts?.[employer.id]?.[b.id] ?? 0;
                    return (
                      <td
                        key={b.id}
                        className="px-4 py-4 whitespace-nowrap text-right text-sm"
                        data-testid={`text-employer-benefit-count-${employer.id}-${b.id}`}
                      >
                        {countsLoading && !benefitCounts ? (
                          <Skeleton className="h-4 w-6 ml-auto" />
                        ) : count > 0 ? (
                          <span className="font-medium tabular-nums">{count}</span>
                        ) : (
                          <span className="text-muted-foreground tabular-nums">0</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center space-x-2">
                      <Link href={`/employers/${employer.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-2 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                          title="View employer"
                          data-testid={`button-view-employer-${employer.id}`}
                        >
                          <Eye size={12} />
                        </Button>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Empty State */}
        {employers.length === 0 && !isLoading && (
          <div className="px-6 py-12 text-center border-t border-border">
            <div className="flex flex-col items-center space-y-4">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                <Building2 className="text-muted-foreground" size={32} />
              </div>
              <div>
                <h3 className="text-lg font-medium text-foreground mb-2">No employers found</h3>
                <p className="text-muted-foreground">Add your first employer using the Add tab.</p>
              </div>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
