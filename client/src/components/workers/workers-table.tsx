import { useState, useMemo } from "react";
import { ArrowUpDown, User, Eye, Search, Home, Building2, MapPin, CheckCircle2, XCircle, Scale, Stethoscope, Smile, Eye as EyeIcon, Star, Download, GraduationCap, Heart, Laptop, ShoppingBag, Mail, Phone, MailX, PhoneOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Worker, Contact, PhoneNumber, Employer, ContactPostal } from "@shared/schema";
import { formatSSN } from "@shared/schema";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { parsePhoneNumber } from "libphonenumber-js";
import { stringify } from 'csv-stringify/browser/esm/sync';
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

interface WorkersTableProps {
  workers: Worker[];
  isLoading: boolean;
}

interface WorkerBenefit {
  id: string;
  name: string;
  typeName: string;
  typeIcon?: string;
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
}

interface EmployerInfo {
  id: string;
  name: string;
  isHome: boolean;
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

export function WorkersTable({ workers, isLoading }: WorkersTableProps) {
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>("all");
  const [selectedBenefitId, setSelectedBenefitId] = useState<string>("all");
  const [contactStatusFilter, setContactStatusFilter] = useState<string>("all");

  // Fetch worker-employer summary
  const { data: workerEmployers = [] } = useQuery<WorkerEmployerSummary[]>({
    queryKey: ["/api/workers/employers/summary"],
    enabled: workers.length > 0,
  });

  // Fetch current month benefits for all workers
  const { data: workerCurrentBenefits = [] } = useQuery<any[]>({
    queryKey: ["/api/workers/benefits/current"],
    enabled: workers.length > 0,
  });

  // Fetch employers for filter dropdown
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  // Fetch trust benefits for filter dropdown
  const { data: trustBenefits = [] } = useQuery<any[]>({
    queryKey: ["/api/trust-benefits"],
  });

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
    };
  });

  // Filter workers based on search query, employer, and benefit
  const filteredWorkers = useMemo(() => {
    let filtered = workersWithNames;
    
    // Filter by employer if selected
    if (selectedEmployerId !== "all") {
      filtered = filtered.filter(worker => 
        worker.employers?.some(emp => emp.id === selectedEmployerId)
      );
    }
    
    // Filter by specific benefit if selected (using benefit IDs)
    if (selectedBenefitId !== "all") {
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
    
    // Filter by search query
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
    
    return filtered;
  }, [workersWithNames, searchQuery, selectedEmployerId, selectedBenefitId, contactStatusFilter]);

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

  // CSV Export function
  const handleExportCSV = () => {
    // Prepare data for CSV export
    const csvData = sortedWorkers.map(worker => {
      // Get current benefits for this worker
      const currentBenefits = currentBenefitsMap.get(worker.id) || [];
      const benefitsString = currentBenefits
        .filter((b: any) => b && b.name)
        .map((b: any) => {
          if (b.employerName) {
            return `${b.name} (${b.employerName})`;
          }
          return b.name;
        })
        .join('; ');

      return {
        'First Name': worker.given || '',
        'Middle Name': worker.middle || '',
        'Last Name': worker.family || '',
        'SSN': formatSSN(worker.ssn),
        'Street': worker.address?.street || '',
        'City': worker.address?.city || '',
        'State': worker.address?.state || '',
        'Postal Code': worker.address?.postalCode || '',
        'Country': worker.address?.country || '',
        'Email': worker.email || '',
        'Phone Number': worker.phoneNumber || '',
        'Current Benefits': benefitsString,
      };
    });

    // Generate CSV string
    const csv = stringify(csvData, {
      header: true,
      columns: [
        'First Name',
        'Middle Name',
        'Last Name',
        'SSN',
        'Street',
        'City',
        'State',
        'Postal Code',
        'Country',
        'Email',
        'Phone Number',
        'Current Benefits'
      ]
    });

    // Create download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `workers_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          
          {/* Filters */}
          <div className="flex gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
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
            
            {/* Employer Filter */}
            <div className="w-64">
              <Select
                value={selectedEmployerId}
                onValueChange={setSelectedEmployerId}
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
                    .map((employer) => (
                      <SelectItem 
                        key={employer.id} 
                        value={employer.id}
                        data-testid={`select-employer-${employer.id}`}
                      >
                        {employer.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Benefit Filter */}
            <div className="w-64">
              <Select
                value={selectedBenefitId}
                onValueChange={setSelectedBenefitId}
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
            
            {/* Contact Status Filter */}
            <div className="w-56">
              <Select
                value={contactStatusFilter}
                onValueChange={setContactStatusFilter}
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
                      <MailX size={14} className="text-red-500" />
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
                      <PhoneOff size={14} className="text-red-500" />
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
                      <span className="relative inline-flex">
                        <Home size={14} className="text-red-500" />
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="w-[140%] h-[2px] bg-red-500 rotate-[-45deg]" />
                        </span>
                      </span>
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
                  <span>Benefits</span>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Employers</span>
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
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1" data-testid={`text-worker-employers-${worker.id}`}>
                      {worker.employers && worker.employers.length > 0 ? (
                        worker.employers.map((employer) => (
                          <Badge
                            key={employer.id}
                            variant={employer.isHome ? "default" : "secondary"}
                            className="text-xs"
                            data-testid={`badge-employer-${employer.id}`}
                          >
                            {employer.isHome && <Home size={10} className="mr-1" />}
                            {employer.name}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground italic">No employers</span>
                      )}
                    </div>
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
      </Card>

    </>
  );
}
