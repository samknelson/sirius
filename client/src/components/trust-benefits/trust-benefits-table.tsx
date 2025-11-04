import { useState, useMemo } from "react";
import { ArrowUpDown, Heart, Eye, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrustBenefit, TrustBenefitType } from "@shared/schema";
import { Link } from "wouter";

interface TrustBenefitsTableProps {
  benefits: TrustBenefit[];
  isLoading: boolean;
  includeInactive: boolean;
  onToggleInactive: () => void;
  benefitTypes: TrustBenefitType[];
  selectedTypeId: string;
  onTypeChange: (typeId: string) => void;
}

const avatarColors = [
  "bg-primary/10 text-primary",
  "bg-accent/10 text-accent", 
  "bg-yellow-100 text-yellow-600",
  "bg-purple-100 text-purple-600",
  "bg-red-100 text-red-600",
];

export function TrustBenefitsTable({ benefits, isLoading, includeInactive, onToggleInactive, benefitTypes, selectedTypeId, onTypeChange }: TrustBenefitsTableProps) {
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");

  // Filter benefits based on search query and type
  const filteredBenefits = useMemo(() => {
    let result = benefits;
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(benefit => {
        const id = benefit.id.toLowerCase();
        const name = benefit.name.toLowerCase();
        
        return id.includes(query) || name.includes(query);
      });
    }
    
    // Filter by type
    if (selectedTypeId) {
      result = result.filter(benefit => benefit.benefitType === selectedTypeId);
    }
    
    return result;
  }, [benefits, searchQuery, selectedTypeId]);

  const sortedBenefits = [...filteredBenefits].sort((a, b) => {
    if (sortOrder === "asc") {
      return a.name.localeCompare(b.name);
    }
    return b.name.localeCompare(a.name);
  });

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
            <h2 className="text-lg font-semibold text-foreground">Trust Benefits Database</h2>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <ArrowUpDown className="text-muted-foreground" size={16} />
                <span className="text-sm text-muted-foreground">Sort by Name</span>
              </div>
              <span className="text-sm font-medium text-primary" data-testid="text-total-benefits">
                {filteredBenefits.length} of {benefits.length}
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
              data-testid="input-search-benefits"
            />
          </div>
          
          {/* Filter by Type */}
          <div className="mb-4">
            <Label htmlFor="filter-type" className="text-sm text-muted-foreground mb-2 block">
              Filter by Type
            </Label>
            <Select value={selectedTypeId} onValueChange={onTypeChange}>
              <SelectTrigger id="filter-type" data-testid="select-filter-type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="" data-testid="option-filter-type-all">
                  All types
                </SelectItem>
                {benefitTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id} data-testid={`option-filter-type-${type.id}`}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
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
              Include inactive trust benefits
            </Label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/20">
              <tr>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors"
                  onClick={toggleSort}
                  data-testid="button-sort-name"
                >
                  <div className="flex items-center space-x-2">
                    <span>Benefit Name</span>
                    <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Type</span>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Status</span>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {sortedBenefits.map((benefit, index) => (
                <tr key={benefit.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-benefit-${benefit.id}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 ${avatarColors[index % avatarColors.length]} rounded-full flex items-center justify-center`}>
                        <Heart size={12} />
                      </div>
                      <span 
                        className="text-sm font-medium text-foreground"
                        data-testid={`text-benefit-name-${benefit.id}`}
                      >
                        {benefit.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span 
                      className="text-sm text-muted-foreground"
                      data-testid={`text-benefit-type-${benefit.id}`}
                    >
                      {(benefit as any).benefitTypeName || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span 
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        benefit.isActive 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                      }`}
                      data-testid={`status-benefit-${benefit.id}`}
                    >
                      {benefit.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center space-x-2">
                      <Link href={`/trust-benefits/${benefit.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-2 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                          title="View benefit"
                          data-testid={`button-view-benefit-${benefit.id}`}
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
        {benefits.length === 0 && !isLoading && (
          <div className="px-6 py-12 text-center border-t border-border">
            <div className="flex flex-col items-center space-y-4">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                <Heart className="text-muted-foreground" size={32} />
              </div>
              <div>
                <h3 className="text-lg font-medium text-foreground mb-2">No trust benefits found</h3>
                <p className="text-muted-foreground">Add your first trust benefit using the Add tab.</p>
              </div>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
