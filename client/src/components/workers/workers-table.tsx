import { useState, useMemo, useEffect } from "react";
import { ArrowUpDown, User, Eye, Search, Home, Building2, MapPin, CheckCircle2, XCircle, Scale, Stethoscope, Smile, Eye as EyeIcon, Star, Download, GraduationCap, Heart, Laptop, ShoppingBag, Mail, Phone, FileText, Briefcase, Users, type LucideIcon } from "lucide-react";
import { renderIcon } from "@/components/ui/icon-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Worker, Contact, PhoneNumber, Employer, ContactPostal } from "@shared/schema";
import { ComponentConfig } from "@shared/components";
import { formatSSN } from "@shared/schema";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { parsePhoneNumber } from "libphonenumber-js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface WorkerFilters {
  employerId: string;
  employerTypeId: string;
  bargainingUnitId: string;
  benefitId: string;
  contactStatus: string;
  cardcheckFilters?: Record<string, string>;
  hasMultipleEmployers?: boolean;
}

interface WorkersTableProps {
  workers: Worker[];
  isLoading: boolean;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  sortOrder?: "asc" | "desc";
  onSortOrderChange?: (order: "asc" | "desc") => void;
  filters?: WorkerFilters;
  onFiltersChange?: (filters: WorkerFilters) => void;
}

interface WorkerBenefit {
  id: string;
  name: string;
  typeName: string;
  typeIcon?: string;
}

interface CardcheckStatusSummary {
  workerId: string;
  definitionId: string;
  definitionName: string;
  definitionIcon: string;
  status: 'signed' | 'pending' | 'revoked' | 'none';
}

interface WorkerWithContact extends Worker {
  contactName?: string;
  email?: string;
  phoneNumber?: string;
  given?: string;
  middle?: string;
  family?: string;
  employers?: EmployerInfo[];
  address?: ContactPostal | null;
  benefitTypes?: string[];
  benefitIds?: string[];
  benefits?: WorkerBenefit[];
  workStatusName?: string;
  bargainingUnitCode?: string | null;
  bargainingUnitName?: string | null;
}

interface EmployerInfo {
  id: string;
  name: string;
  isHome: boolean;
  employmentStatusId?: string;
  employmentStatusName?: string;
  employmentStatusCode?: string;
  employmentStatusEmployed?: boolean;
  employmentStatusColor?: string;
  employerTypeId?: string;
  employerTypeName?: string;
  employerTypeIcon?: string;
}

interface WorkerEmployerSummary {
  workerId: string;
  employers: EmployerInfo[];
  homeEmployerId: string | null;
}

const avatarColors = [
  "bg-primary/10 text-primary",
  "bg-accent/10 text-accent", 
  "bg-yellow-100 text-yellow-600",
  "bg-purple-100 text-purple-600",
  "bg-red-100 text-red-600",
];

// Map icon names from database to Lucide React components
const iconMap: Record<string, LucideIcon> = {
  'Scale': Scale,
  'Stethoscope': Stethoscope,
  'Smile': Smile,
  'Eye': EyeIcon,
  'Star': Star,
  'Home': Home,
  'GraduationCap': GraduationCap,
  'Heart': Heart,
  'Laptop': Laptop,
  'ShoppingBag': ShoppingBag,
};

// Map icon names to colors
const iconColorMap: Record<string, string> = {
  'Scale': 'text-blue-600',
  'Stethoscope': 'text-red-600',
  'Smile': 'text-green-600',
  'Eye': 'text-purple-600',
  'Star': 'text-yellow-600',
  'Home': 'text-orange-600',
  'GraduationCap': 'text-indigo-600',
  'Heart': 'text-pink-600',
  'Laptop': 'text-cyan-600',
  'ShoppingBag': 'text-teal-600',
};

// Get icon component and color from icon name
const getIconByName = (iconName?: string) => {
  const Icon = iconName && iconMap[iconName] ? iconMap[iconName] : Star;
  const color = iconName && iconColorMap[iconName] ? iconColorMap[iconName] : 'text-gray-600';
  return { Icon, color };
};

export function WorkersTable({ 
  workers, 
  isLoading,
  page = 1,
  pageSize = 50,
  totalPages = 1,
  total = 0,
  onPageChange,
  searchQuery: externalSearchQuery,
  onSearchChange,
  sortOrder: externalSortOrder,
  onSortOrderChange,
  filters: externalFilters,
  onFiltersChange,
}: WorkersTableProps) {
  const isPaginated = onPageChange !== undefined;
  const [internalSortOrder, setInternalSortOrder] = useState<"asc" | "desc">("asc");
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [internalFilters, setInternalFilters] = useState<WorkerFilters>({
    employerId: "all",
    employerTypeId: "all",
    bargainingUnitId: "all",
    benefitId: "all",
    contactStatus: "all",
    cardcheckFilters: {},
  });
  
  const sortOrder = externalSortOrder ?? internalSortOrder;
  const setSortOrder = onSortOrderChange ?? setInternalSortOrder;
  const searchQuery = externalSearchQuery ?? internalSearchQuery;
  const setSearchQuery = onSearchChange ?? setInternalSearchQuery;
  
  // Use external filters if provided (server-side filtering), otherwise use internal
  const filters = externalFilters ?? internalFilters;
  const setFilters = onFiltersChange ?? setInternalFilters;
  
  const selectedEmployerId = filters.employerId;
  const selectedBenefitId = filters.benefitId;
  const contactStatusFilter = filters.contactStatus;
  const selectedEmployerTypeId = filters.employerTypeId;
  const selectedBargainingUnitId = filters.bargainingUnitId;
  const cardcheckFilters = filters.cardcheckFilters ?? {};
  
  // Helper to update a single filter
  const updateFilter = (key: keyof WorkerFilters, value: string) => {
    setFilters({ ...filters, [key]: value });
  };
  
  const setCardcheckFilters = (newFilters: Record<string, string>) => {
    setFilters({ ...filters, cardcheckFilters: newFilters });
  };

  // Fetch component configs to check if trust benefits is enabled
  const { data: componentConfigs = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
  });
  const trustBenefitsEnabled = componentConfigs.find(c => c.componentId === "trust.benefits")?.enabled ?? false;
  const cardcheckEnabled = componentConfigs.find(c => c.componentId === "cardcheck")?.enabled ?? false;

  // Reset benefit filter when trust.benefits is disabled
  useEffect(() => {
    if (!trustBenefitsEnabled && selectedBenefitId !== "all") {
      updateFilter("benefitId", "all");
    }
  }, [trustBenefitsEnabled, selectedBenefitId]);

  // Fetch worker-employer summary
  const { data: workerEmployers = [] } = useQuery<WorkerEmployerSummary[]>({
    queryKey: ["/api/workers/employers/summary"],
    enabled: workers.length > 0,
  });

  // Fetch current month benefits for all workers (only when trust.benefits is enabled)
  const { data: workerCurrentBenefits = [] } = useQuery<any[]>({
    queryKey: ["/api/workers/benefits/current"],
    enabled: workers.length > 0 && trustBenefitsEnabled,
  });

  // Fetch employers for filter dropdown
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  // Fetch employer types for filter dropdown icons
  const { data: employerTypes = [] } = useQuery<{ id: string; name: string; data?: Record<string, unknown> | null }[]>({
    queryKey: ["/api/employer-types"],
  });

  // Fetch bargaining units for filter dropdown
  const { data: bargainingUnits = [] } = useQuery<{ id: string; siriusId: string; name: string; data?: { icon?: string } | null }[]>({
    queryKey: ["/api/bargaining-units"],
  });

  
  // Create map for employer type icons
  const employerTypeIconMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of employerTypes) {
      const iconName = type.data?.icon;
      if (typeof iconName === "string") {
        map.set(type.id, iconName);
      }
    }
    return map;
  }, [employerTypes]);

  // Fetch trust benefits for filter dropdown (only when trust.benefits is enabled)
  const { data: trustBenefits = [] } = useQuery<any[]>({
    queryKey: ["/api/trust-benefits"],
    enabled: trustBenefitsEnabled,
  });

  // Fetch cardcheck status summary (only when cardcheck is enabled)
  const { data: cardcheckStatusSummary = [] } = useQuery<CardcheckStatusSummary[]>({
    queryKey: ["/api/cardchecks/status-summary"],
    enabled: workers.length > 0 && cardcheckEnabled,
  });

  // Fetch cardcheck definitions for filters (only when cardcheck is enabled)
  const { data: cardcheckDefinitions = [] } = useQuery<{ id: string; name: string; data?: { icon?: string } | null }[]>({
    queryKey: ["/api/cardcheck/definitions"],
    enabled: cardcheckEnabled,
    staleTime: 0,
  });

  // Create map for worker cardcheck statuses
  const cardcheckMap = useMemo(() => {
    const map = new Map<string, CardcheckStatusSummary[]>();
    for (const summary of cardcheckStatusSummary) {
      if (!map.has(summary.workerId)) {
        map.set(summary.workerId, []);
      }
      map.get(summary.workerId)!.push(summary);
    }
    return map;
  }, [cardcheckStatusSummary]);

  // Get cardcheck definitions with icons for filter dropdowns
  // Use status summary as primary source (synced with column display), 
  // fall back to definitions for definitions without worker records yet
  const cardcheckDefinitionsWithIcons = useMemo(() => {
    const defsMap = new Map<string, { id: string; name: string; icon: string }>();
    
    // First, add definitions from status summary (always in sync with column display)
    for (const summary of cardcheckStatusSummary) {
      if (summary.definitionIcon && !defsMap.has(summary.definitionId)) {
        defsMap.set(summary.definitionId, {
          id: summary.definitionId,
          name: summary.definitionName,
          icon: summary.definitionIcon,
        });
      }
    }
    
    // Then add any additional definitions with icons from definitions query
    for (const def of cardcheckDefinitions) {
      if (def.data?.icon && !defsMap.has(def.id)) {
        defsMap.set(def.id, {
          id: def.id,
          name: def.name,
          icon: def.data.icon,
        });
      }
    }
    
    return Array.from(defsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [cardcheckStatusSummary, cardcheckDefinitions]);

  // Create map for worker employers
  const employerMap = new Map(workerEmployers.map(we => [we.workerId, we.employers]));

  // Create map for worker current benefits
  const currentBenefitsMap = new Map(workerCurrentBenefits.map((wb: any) => [wb.workerId, wb.benefits]));

  // Add employer information to workers (contact, phone, and address data already included in workers from optimized endpoint)
  const workersWithNames: WorkerWithContact[] = workers.map((worker: any) => {
    const employers = employerMap.get(worker.id) || [];
    
    let formattedPhone = '';
    if (worker.phone_number) {
      try {
        const parsed = parsePhoneNumber(worker.phone_number, 'US');
        formattedPhone = parsed ? parsed.formatNational() : worker.phone_number;
      } catch {
        formattedPhone = worker.phone_number;
      }
    }
    
    // Build address object if address data exists
    let address: ContactPostal | null = null;
    if (worker.address_id) {
      address = {
        id: worker.address_id,
        contactId: worker.contact_id,
        friendlyName: worker.address_friendly_name,
        street: worker.address_street,
        city: worker.address_city,
        state: worker.address_state,
        postalCode: worker.address_postal_code,
        country: worker.address_country,
        isPrimary: worker.address_is_primary,
        isActive: true,
        validationResponse: null,
        latitude: null,
        longitude: null,
        accuracy: null,
        createdAt: new Date(),
      };
    }
    
    // Parse benefit types from JSON array
    let benefitTypes: string[] = [];
    if (worker.benefit_types) {
      try {
        benefitTypes = Array.isArray(worker.benefit_types) 
          ? worker.benefit_types 
          : JSON.parse(worker.benefit_types);
      } catch {
        benefitTypes = [];
      }
    }
    
    // Parse benefit IDs from JSON array
    let benefitIds: string[] = [];
    if (worker.benefit_ids) {
      try {
        benefitIds = Array.isArray(worker.benefit_ids) 
          ? worker.benefit_ids 
          : JSON.parse(worker.benefit_ids);
      } catch {
        benefitIds = [];
      }
    }
    
    // Parse benefits from JSON array
    let benefits: WorkerBenefit[] = [];
    if (worker.benefits) {
      try {
        benefits = Array.isArray(worker.benefits) 
          ? worker.benefits 
          : JSON.parse(worker.benefits);
      } catch {
        benefits = [];
      }
    }
    
    return {
      ...worker,
      contactId: worker.contact_id,
      siriusId: worker.sirius_id,
      denormWsId: worker.denorm_ws_id,
      denormHomeEmployerId: worker.denorm_home_employer_id,
      denormEmployerIds: worker.denorm_employer_ids,
      contactName: worker.contact_name || 'Unknown',
      email: worker.contact_email || '',
      phoneNumber: formattedPhone,
      given: worker.given,
      middle: worker.middle,
      family: worker.family,
      employers,
      address,
      benefitTypes,
      benefitIds,
      benefits,
      workStatusName: worker.work_status_name || '',
      bargainingUnitId: worker.bargaining_unit_id || undefined,
      bargainingUnitCode: worker.bargaining_unit_code || undefined,
      bargainingUnitName: worker.bargaining_unit_name || undefined,
    };
  });

  // Filter workers based on search query, employer, and benefit
  // When using server-side pagination (isPaginated), skip client-side filters as they're already applied on the server
  const filteredWorkers = useMemo(() => {
    let filtered = workersWithNames;
    
    // Skip these filters when using server-side pagination - they're handled by the API
    if (!isPaginated) {
      // Filter by employer if selected
      if (selectedEmployerId !== "all") {
        filtered = filtered.filter(worker => 
          worker.employers?.some(emp => emp.id === selectedEmployerId)
        );
      }
      
      // Filter by employer type if selected
      if (selectedEmployerTypeId !== "all") {
        filtered = filtered.filter(worker => 
          worker.employers?.some(emp => emp.employerTypeId === selectedEmployerTypeId)
        );
      }
      
      // Filter by bargaining unit if selected
      if (selectedBargainingUnitId !== "all") {
        filtered = filtered.filter(worker => 
          worker.bargainingUnitId === selectedBargainingUnitId
        );
      }
      
      // Filter by specific benefit if selected (using benefit IDs) - only when trust.benefits is enabled
      if (trustBenefitsEnabled && selectedBenefitId !== "all") {
        filtered = filtered.filter(worker => 
          worker.benefitIds?.includes(selectedBenefitId)
        );
      }
      
      // Filter by contact status
      if (contactStatusFilter !== "all") {
        filtered = filtered.filter(worker => {
          const hasEmail = Boolean(worker.email);
          const hasPhone = Boolean(worker.phoneNumber);
          const hasAddress = Boolean(worker.address);
          
          switch (contactStatusFilter) {
            case "has_email":
              return hasEmail;
            case "missing_email":
              return !hasEmail;
            case "has_phone":
              return hasPhone;
            case "missing_phone":
              return !hasPhone;
            case "has_address":
              return hasAddress;
            case "missing_address":
              return !hasAddress;
            case "complete":
              return hasEmail && hasPhone && hasAddress;
            case "incomplete":
              return !hasEmail || !hasPhone || !hasAddress;
            default:
              return true;
          }
        });
      }
      
      // Filter by search query (only client-side when not paginated)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(worker => {
          const name = (worker.contactName || '').toLowerCase();
          const email = (worker.email || '').toLowerCase();
          const phone = (worker.phoneNumber || '').toLowerCase();
          const ssn = formatSSN(worker.ssn).toLowerCase();
          
          return name.includes(query) || 
                 email.includes(query) || 
                 phone.includes(query) || 
                 ssn.includes(query);
        });
      }
    }
    
    // Cardcheck filtering is always done client-side since it's not yet supported on the server
    if (cardcheckEnabled) {
      const activeFilters = Object.entries(cardcheckFilters).filter(([_, value]) => value !== "all");
      if (activeFilters.length > 0) {
        filtered = filtered.filter(worker => {
          const workerCardchecks = cardcheckMap.get(worker.id) || [];
          return activeFilters.every(([definitionId, filterValue]) => {
            const cardcheck = workerCardchecks.find(cc => cc.definitionId === definitionId);
            const status = cardcheck?.status || 'none';
            return status === filterValue;
          });
        });
      }
    }
    
    return filtered;
  }, [workersWithNames, searchQuery, selectedEmployerId, selectedEmployerTypeId, selectedBargainingUnitId, selectedBenefitId, contactStatusFilter, trustBenefitsEnabled, cardcheckEnabled, cardcheckFilters, cardcheckMap, isPaginated]);

  const sortedWorkers = [...filteredWorkers].sort((a, b) => {
    const familyA = a.family || '';
    const familyB = b.family || '';
    const givenA = a.given || '';
    const givenB = b.given || '';
    
    if (sortOrder === "asc") {
      // Sort by family name first, then by given name
      const familyCompare = familyA.localeCompare(familyB);
      if (familyCompare !== 0) return familyCompare;
      return givenA.localeCompare(givenB);
    } else {
      // Sort by family name first (descending), then by given name (descending)
      const familyCompare = familyB.localeCompare(familyA);
      if (familyCompare !== 0) return familyCompare;
      return givenB.localeCompare(givenA);
    }
  });

  const toggleSort = () => {
    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
  };

  // CSV Export function - calls server endpoint to get all matching workers
  const handleExportCSV = () => {
    // Build URL with current filter parameters
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    params.set('sortOrder', sortOrder);
    if (selectedEmployerId !== 'all') params.set('employerId', selectedEmployerId);
    if (selectedEmployerTypeId !== 'all') params.set('employerTypeId', selectedEmployerTypeId);
    if (selectedBargainingUnitId !== 'all') params.set('bargainingUnitId', selectedBargainingUnitId);
    if (selectedBenefitId !== 'all') params.set('benefitId', selectedBenefitId);
    if (contactStatusFilter !== 'all') params.set('contactStatus', contactStatusFilter);
    if (trustBenefitsEnabled) params.set('includeBenefits', 'true');
    
    // Trigger download by opening the export URL
    const exportUrl = `/api/workers/export?${params.toString()}`;
    window.location.href = exportUrl;
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
            <h2 className="text-lg font-semibold text-foreground">Workers Database</h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center space-x-2">
                <ArrowUpDown className="text-muted-foreground" size={16} />
                <span className="text-sm text-muted-foreground">Sort by Name</span>
              </div>
              <span className="text-sm font-medium text-primary" data-testid="text-total-workers">
                {filteredWorkers.length} of {workers.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCSV}
                data-testid="button-export-csv"
                className="gap-2"
              >
                <Download size={16} />
                Export CSV
              </Button>
            </div>
          </div>
          
          {/* Search Input - own row */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={16} />
            <Input
              type="text"
              placeholder="Search by name, email, phone, or SSN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-workers"
            />
          </div>
          
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            {/* Employer Filter */}
            <div className="w-64">
              <Select
                value={selectedEmployerId}
                onValueChange={(value) => updateFilter("employerId", value)}
              >
                <SelectTrigger data-testid="select-employer-filter">
                  <div className="flex items-center gap-2">
                    <Building2 size={16} className="text-muted-foreground" />
                    <SelectValue placeholder="All Employers" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employers</SelectItem>
                  {employers
                    .filter(emp => emp.isActive)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((employer) => {
                      const icon = employer.typeId ? employerTypeIconMap.get(employer.typeId) : null;
                      return (
                        <SelectItem 
                          key={employer.id} 
                          value={employer.id}
                          data-testid={`select-employer-${employer.id}`}
                        >
                          <div className="flex items-center gap-2">
                            {renderIcon(icon || "Building", "h-4 w-4 text-muted-foreground")}
                            <span>{employer.name}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>
            
            {/* Employer Type Filter */}
            <div className="w-56">
              <Select
                value={selectedEmployerTypeId}
                onValueChange={(value) => updateFilter("employerTypeId", value)}
              >
                <SelectTrigger data-testid="select-employer-type-filter">
                  <div className="flex items-center gap-2">
                    <Briefcase size={16} className="text-muted-foreground" />
                    <SelectValue placeholder="All Employer Types" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employer Types</SelectItem>
                  {employerTypes
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((type) => {
                      const iconName = type.data?.icon as string | undefined;
                      return (
                        <SelectItem 
                          key={type.id} 
                          value={type.id}
                          data-testid={`select-employer-type-${type.id}`}
                        >
                          <div className="flex items-center gap-2">
                            {renderIcon(iconName || "Building", "h-4 w-4 text-muted-foreground")}
                            <span>{type.name}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>
            
            {/* Bargaining Unit Filter */}
            <div className="w-48">
              <Select
                value={selectedBargainingUnitId}
                onValueChange={(value) => updateFilter("bargainingUnitId", value)}
              >
                <SelectTrigger data-testid="select-bargaining-unit-filter">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-muted-foreground" />
                    <SelectValue placeholder="All Units" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Units</SelectItem>
                  {bargainingUnits
                    .sort((a, b) => a.siriusId.localeCompare(b.siriusId))
                    .map((unit) => {
                      const iconName = unit.data?.icon;
                      return (
                        <SelectItem 
                          key={unit.id} 
                          value={unit.id}
                          data-testid={`select-bargaining-unit-${unit.id}`}
                        >
                          <div className="flex items-center gap-2">
                            {renderIcon(iconName || "Users", "h-4 w-4 text-muted-foreground")}
                            <span>{unit.siriusId} - {unit.name}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>
            
            {/* Benefit Filter - only show when trust.benefits component is enabled */}
            {trustBenefitsEnabled && (
              <div className="w-64">
                <Select
                  value={selectedBenefitId}
                  onValueChange={(value) => updateFilter("benefitId", value)}
                >
                  <SelectTrigger data-testid="select-benefit-filter">
                    <div className="flex items-center gap-2">
                      <Star size={16} className="text-muted-foreground" />
                      <SelectValue placeholder="All Benefits" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Benefits</SelectItem>
                    {trustBenefits
                      .filter(benefit => benefit.isActive)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((benefit) => {
                        const { Icon, color } = getIconByName(benefit.benefitTypeIcon);
                        return (
                          <SelectItem 
                            key={benefit.id} 
                            value={benefit.id}
                            data-testid={`select-benefit-${benefit.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <Icon size={14} className={color} />
                              <span>{benefit.name}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {/* Contact Status Filter */}
            <div className="w-56">
              <Select
                value={contactStatusFilter}
                onValueChange={(value) => updateFilter("contactStatus", value)}
              >
                <SelectTrigger data-testid="select-contact-status-filter">
                  <div className="flex items-center gap-2">
                    <User size={16} className="text-muted-foreground" />
                    <SelectValue placeholder="Contact Status" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Contact Status</SelectItem>
                  <SelectItem value="has_email">
                    <div className="flex items-center gap-2">
                      <Mail size={14} className="text-green-600" />
                      <span>Has Email</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="missing_email">
                    <div className="flex items-center gap-2">
                      <Mail size={14} className="text-red-500" />
                      <span>Missing Email</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="has_phone">
                    <div className="flex items-center gap-2">
                      <Phone size={14} className="text-green-600" />
                      <span>Has Phone</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="missing_phone">
                    <div className="flex items-center gap-2">
                      <Phone size={14} className="text-red-500" />
                      <span>Missing Phone</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="has_address">
                    <div className="flex items-center gap-2">
                      <Home size={14} className="text-green-600" />
                      <span>Has Address</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="missing_address">
                    <div className="flex items-center gap-2">
                      <Home size={14} className="text-red-500" />
                      <span>Missing Address</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="complete">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-green-600" />
                      <span>Complete Contact Info</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="incomplete">
                    <div className="flex items-center gap-2">
                      <XCircle size={14} className="text-orange-500" />
                      <span>Incomplete Contact Info</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Multiple Employers Filter */}
            <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-background">
              <Checkbox
                id="multiple-employers-filter"
                checked={filters.hasMultipleEmployers ?? false}
                onCheckedChange={(checked) => 
                  setFilters({ ...filters, hasMultipleEmployers: checked === true })
                }
                data-testid="checkbox-multiple-employers"
              />
              <label 
                htmlFor="multiple-employers-filter" 
                className="text-sm cursor-pointer flex items-center gap-2 whitespace-nowrap"
              >
                <Users size={14} className="text-muted-foreground" />
                Multiple Employers
              </label>
            </div>
            
            {/* Card Check Status Filters - one per definition with icon */}
            {cardcheckEnabled && cardcheckDefinitionsWithIcons.map((def) => (
              <div key={def.id} className="w-48">
                <Select
                  value={cardcheckFilters[def.id] || "all"}
                  onValueChange={(value) => setCardcheckFilters({ ...cardcheckFilters, [def.id]: value })}
                >
                  <SelectTrigger data-testid={`select-cardcheck-filter-${def.id}`}>
                    <div className="flex items-center gap-2">
                      {renderIcon(def.icon, "h-4 w-4 text-muted-foreground")}
                      <SelectValue placeholder={`All ${def.name}`} />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All {def.name}</SelectItem>
                    <SelectItem value="signed">
                      <div className="flex items-center gap-2">
                        {renderIcon(def.icon, "h-3.5 w-3.5 text-green-600")}
                        <span>Signed</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="pending">
                      <div className="flex items-center gap-2">
                        {renderIcon(def.icon, "h-3.5 w-3.5 text-yellow-500")}
                        <span>Pending signature</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="none">
                      <div className="flex items-center gap-2">
                        {renderIcon(def.icon, "h-3.5 w-3.5 text-yellow-500")}
                        <span>None on file</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="revoked">
                      <div className="flex items-center gap-2">
                        {renderIcon(def.icon, "h-3.5 w-3.5 text-red-600")}
                        <span>Revoked</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/20">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <div className="flex items-center space-x-2">
                    <span>Sirius ID</span>
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors"
                  onClick={toggleSort}
                  data-testid="button-sort-name"
                >
                  <div className="flex items-center space-x-2">
                    <span>Worker Name</span>
                    <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Contact</span>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Unit</span>
                </th>
                {trustBenefitsEnabled && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <span>Benefits</span>
                  </th>
                )}
                {cardcheckEnabled && cardcheckStatusSummary.length > 0 && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <span>Card Checks</span>
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Employment</span>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {sortedWorkers.map((worker, index) => (
                <tr key={worker.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-worker-${worker.id}`}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-muted-foreground">
                    {worker.siriusId}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 ${avatarColors[index % avatarColors.length]} rounded-full flex items-center justify-center`}>
                        <User size={12} />
                      </div>
                      <span 
                        className="text-sm font-medium text-foreground"
                        data-testid={`text-worker-name-${worker.id}`}
                      >
                        {worker.contactName}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2" data-testid={`contact-indicators-${worker.id}`}>
                      {worker.email ? (
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <div 
                              className="cursor-pointer"
                              data-testid={`email-indicator-${worker.id}`}
                              aria-label={`Email for ${worker.contactName}`}
                            >
                              <Mail size={16} className="text-green-600" />
                            </div>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-80" data-testid={`email-hover-${worker.id}`}>
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-foreground">
                                {worker.contactName}
                              </p>
                              <div className="flex items-center gap-2">
                                <Mail size={16} className="text-muted-foreground" />
                                <span className="text-sm text-foreground">{worker.email}</span>
                              </div>
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      ) : (
                        <Link href={`/workers/${worker.id}/email`}>
                          <div 
                            data-testid={`email-indicator-${worker.id}`}
                            aria-label={`Add email for ${worker.contactName}`}
                            className="cursor-pointer hover:opacity-70 transition-opacity"
                          >
                            <Mail size={16} className="text-red-500" />
                          </div>
                        </Link>
                      )}
                      
                      {worker.phoneNumber ? (
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <div 
                              className="cursor-pointer"
                              data-testid={`phone-indicator-${worker.id}`}
                              aria-label={`Phone for ${worker.contactName}`}
                            >
                              <Phone size={16} className="text-green-600" />
                            </div>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-80" data-testid={`phone-hover-${worker.id}`}>
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-foreground">
                                {worker.contactName}
                              </p>
                              <div className="flex items-center gap-2">
                                <Phone size={16} className="text-muted-foreground" />
                                <span className="text-sm text-foreground">{worker.phoneNumber}</span>
                              </div>
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      ) : (
                        <Link href={`/workers/${worker.id}/phone-numbers`}>
                          <div 
                            data-testid={`phone-indicator-${worker.id}`}
                            aria-label={`Add phone for ${worker.contactName}`}
                            className="cursor-pointer hover:opacity-70 transition-opacity"
                          >
                            <Phone size={16} className="text-red-500" />
                          </div>
                        </Link>
                      )}
                      
                      {worker.address ? (
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <div 
                              className="cursor-pointer"
                              data-testid={`address-indicator-${worker.id}`}
                              aria-label={`Address for ${worker.contactName}`}
                            >
                              <Home size={16} className="text-green-600" />
                            </div>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-80" data-testid={`address-hover-${worker.id}`}>
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-foreground">
                                {worker.contactName}
                              </p>
                              <div className="flex items-start gap-2">
                                <MapPin size={16} className="text-muted-foreground mt-0.5" />
                                <div className="flex-1">
                                  <p className="text-sm text-foreground">
                                    {worker.address.street}
                                  </p>
                                  <p className="text-sm text-foreground">
                                    {worker.address.city}, {worker.address.state} {worker.address.postalCode}
                                  </p>
                                  {worker.address.country && worker.address.country !== 'US' && (
                                    <p className="text-sm text-foreground">
                                      {worker.address.country}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      ) : (
                        <Link href={`/workers/${worker.id}/addresses`}>
                          <div 
                            data-testid={`address-indicator-${worker.id}`}
                            aria-label={`Add address for ${worker.contactName}`}
                            className="cursor-pointer hover:opacity-70 transition-opacity"
                          >
                            <Home size={16} className="text-red-500" />
                          </div>
                        </Link>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <TooltipProvider>
                      {worker.bargainingUnitCode ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span 
                              className="text-sm font-medium text-foreground cursor-help"
                              data-testid={`unit-code-${worker.id}`}
                            >
                              {worker.bargainingUnitCode}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{worker.bargainingUnitName}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">-</span>
                      )}
                    </TooltipProvider>
                  </td>
                  {trustBenefitsEnabled && (
                    <td className="px-6 py-4 whitespace-nowrap">
                      <TooltipProvider>
                        <div className="flex items-center gap-2" data-testid={`benefits-icons-${worker.id}`}>
                          {worker.benefits && worker.benefits.length > 0 ? (
                            worker.benefits.map((benefit, index) => {
                              const { Icon, color } = getIconByName(benefit.typeIcon);
                              return (
                                <Tooltip key={index}>
                                  <TooltipTrigger asChild>
                                    <div className="cursor-help">
                                      <Icon size={16} className={color} />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{benefit.name}</p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })
                          ) : (
                            <span className="text-sm text-muted-foreground italic">None</span>
                          )}
                        </div>
                      </TooltipProvider>
                    </td>
                  )}
                  {cardcheckEnabled && cardcheckStatusSummary.length > 0 && (
                    <td className="px-6 py-4 whitespace-nowrap">
                      <TooltipProvider>
                        <div className="flex items-center gap-2" data-testid={`cardcheck-icons-${worker.id}`}>
                          {(() => {
                            const workerCardchecks = cardcheckMap.get(worker.id) || [];
                            if (workerCardchecks.length === 0) {
                              return <span className="text-sm text-muted-foreground italic">-</span>;
                            }
                            return workerCardchecks.map((cc) => {
                              const statusColor = cc.status === 'signed' 
                                ? 'text-green-600' 
                                : cc.status === 'revoked' 
                                  ? 'text-red-600' 
                                  : 'text-yellow-500';
                              const statusLabel = cc.status === 'signed' 
                                ? 'Signed' 
                                : cc.status === 'revoked' 
                                  ? 'Revoked' 
                                  : cc.status === 'pending'
                                    ? 'Pending signature'
                                    : 'None on file';
                              return (
                                <Tooltip key={cc.definitionId}>
                                  <TooltipTrigger asChild>
                                    <div className="cursor-help">
                                      {renderIcon(cc.definitionIcon, `h-4 w-4 ${statusColor}`)}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{cc.definitionName}: {statusLabel}</p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            });
                          })()}
                        </div>
                      </TooltipProvider>
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <TooltipProvider>
                      <div className="flex items-center gap-1" data-testid={`employment-indicators-${worker.id}`}>
                        {worker.employers && worker.employers.length > 0 ? (
                          [...worker.employers].sort((a, b) => (b.isHome ? 1 : 0) - (a.isHome ? 1 : 0)).map((employer) => (
                            <Tooltip key={employer.id}>
                              <TooltipTrigger asChild>
                                <span 
                                  className="cursor-help inline-flex"
                                  style={{ color: employer.isHome ? "#22c55e" : "#3b82f6" }}
                                  tabIndex={0}
                                  data-testid={`employment-icon-${employer.id}`}
                                >
                                  {renderIcon(employer.employerTypeIcon || "Building", "h-5 w-5")}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-sm">
                                  <p className="font-medium">{employer.name}</p>
                                  <p className="text-muted-foreground">
                                    {employer.employmentStatusName || "No status"}
                                    {employer.isHome && " (Home)"}
                                  </p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">None</span>
                        )}
                      </div>
                    </TooltipProvider>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center space-x-2">
                      <Link href={`/workers/${worker.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-2 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                          title="View worker"
                          data-testid={`button-view-worker-${worker.id}`}
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
        {workers.length === 0 && !isLoading && (
          <div className="px-6 py-12 text-center border-t border-border">
            <div className="flex flex-col items-center space-y-4">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                <User className="text-muted-foreground" size={32} />
              </div>
              <div>
                <h3 className="text-lg font-medium text-foreground mb-2">No workers found</h3>
                <p className="text-muted-foreground">Add your first worker using the form above.</p>
              </div>
            </div>
          </div>
        )}

        {/* Pagination Controls */}
        {isPaginated && totalPages > 1 && (
          <div className="px-6 py-4 border-t border-border flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground" data-testid="text-pagination-info">
              Showing {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, total)} of {total.toLocaleString()} workers
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange?.(1)}
                disabled={page === 1}
                data-testid="button-page-first"
              >
                First
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange?.(page - 1)}
                disabled={page === 1}
                data-testid="button-page-prev"
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground px-2" data-testid="text-page-number">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange?.(page + 1)}
                disabled={page === totalPages}
                data-testid="button-page-next"
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange?.(totalPages)}
                disabled={page === totalPages}
                data-testid="button-page-last"
              >
                Last
              </Button>
            </div>
          </div>
        )}
      </Card>

    </>
  );
}
