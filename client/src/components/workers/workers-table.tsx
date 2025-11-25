import { useState, useMemo } from "react";
import { ArrowUpDown, User, Eye, Search, Home, Building2, MapPin, CheckCircle2, XCircle, Scale, Stethoscope, Smile, Eye as EyeIcon, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Worker, Contact, PhoneNumber, Employer, PostalAddress } from "@shared/schema";
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

interface WorkersTableProps {
  workers: Worker[];
  isLoading: boolean;
}

interface WorkerWithContact extends Worker {
  contactName?: string;
  email?: string;
  phoneNumber?: string;
  employers?: EmployerInfo[];
  address?: PostalAddress | null;
  benefitTypes?: string[];
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

// Map benefit types to icons and colors
const getBenefitIcon = (benefitType: string) => {
  const type = benefitType.toLowerCase();
  if (type.includes('legal')) {
    return { Icon: Scale, color: 'text-blue-600', label: 'Legal' };
  }
  if (type.includes('medical') || type.includes('health')) {
    return { Icon: Stethoscope, color: 'text-red-600', label: 'Medical' };
  }
  if (type.includes('dental')) {
    return { Icon: Smile, color: 'text-green-600', label: 'Dental' };
  }
  if (type.includes('vision')) {
    return { Icon: EyeIcon, color: 'text-purple-600', label: 'Vision' };
  }
  return { Icon: Star, color: 'text-yellow-600', label: benefitType };
};

export function WorkersTable({ workers, isLoading }: WorkersTableProps) {
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>("all");

  // Fetch worker-employer summary
  const { data: workerEmployers = [] } = useQuery<WorkerEmployerSummary[]>({
    queryKey: ["/api/workers/employers/summary"],
    enabled: workers.length > 0,
  });

  // Fetch employers for filter dropdown
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  // Create map for worker employers
  const employerMap = new Map(workerEmployers.map(we => [we.workerId, we.employers]));

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
    let address: PostalAddress | null = null;
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
      employers,
      address,
      benefitTypes,
    };
  });

  // Filter workers based on search query and employer
  const filteredWorkers = useMemo(() => {
    let filtered = workersWithNames;
    
    // Filter by employer if selected
    if (selectedEmployerId !== "all") {
      filtered = filtered.filter(worker => 
        worker.employers?.some(emp => emp.id === selectedEmployerId)
      );
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
  }, [workersWithNames, searchQuery, selectedEmployerId]);

  const sortedWorkers = [...filteredWorkers].sort((a, b) => {
    const nameA = a.contactName || '';
    const nameB = b.contactName || '';
    if (sortOrder === "asc") {
      return nameA.localeCompare(nameB);
    }
    return nameB.localeCompare(nameA);
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
            <h2 className="text-lg font-semibold text-foreground">Workers Database</h2>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <ArrowUpDown className="text-muted-foreground" size={16} />
                <span className="text-sm text-muted-foreground">Sort by Name</span>
              </div>
              <span className="text-sm font-medium text-primary" data-testid="text-total-workers">
                {filteredWorkers.length} of {workers.length}
              </span>
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
                  <span>Email</span>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Phone</span>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Address</span>
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
                    <span 
                      className="text-sm text-foreground"
                      data-testid={`text-worker-email-${worker.id}`}
                    >
                      {worker.email || <span className="text-muted-foreground italic">No email</span>}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span 
                      className="text-sm text-foreground"
                      data-testid={`text-worker-phone-${worker.id}`}
                    >
                      {worker.phoneNumber || <span className="text-muted-foreground italic">No phone</span>}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {worker.address ? (
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <div 
                            className="flex items-center gap-2 cursor-pointer"
                            data-testid={`address-indicator-${worker.id}`}
                          >
                            <CheckCircle2 size={16} className="text-green-600" />
                            <span className="text-sm text-green-600">Has Address</span>
                          </div>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-80" data-testid={`address-hover-${worker.id}`}>
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <MapPin size={16} className="text-muted-foreground mt-0.5" />
                              <div className="flex-1">
                                {worker.address.friendlyName && (
                                  <p className="text-sm font-semibold text-foreground mb-1">
                                    {worker.address.friendlyName}
                                  </p>
                                )}
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
                      <div className="flex items-center gap-2" data-testid={`address-indicator-${worker.id}`}>
                        <XCircle size={16} className="text-muted-foreground" />
                        <span className="text-sm text-muted-foreground italic">No address</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <TooltipProvider>
                      <div className="flex items-center gap-2" data-testid={`benefits-icons-${worker.id}`}>
                        {worker.benefitTypes && worker.benefitTypes.length > 0 ? (
                          worker.benefitTypes.map((benefitType, index) => {
                            const { Icon, color, label } = getBenefitIcon(benefitType);
                            return (
                              <Tooltip key={index}>
                                <TooltipTrigger asChild>
                                  <div className="cursor-help">
                                    <Icon size={16} className={color} />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{label}</p>
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
