import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import { ListBulkAction } from "@/components/bulk/list-bulk-action";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Eye, 
  Search, 
  User, 
  Phone, 
  Mail, 
  Building, 
  Briefcase, 
  FileText, 
  CreditCard, 
  Truck, 
  HardHat, 
  Users,
  type LucideIcon 
} from "lucide-react";
import type { Employer, Contact, EmployerContact, EmployerContactType } from "@shared/schema";

const iconMap: Record<string, LucideIcon> = {
  User,
  Phone,
  Mail,
  Building,
  Briefcase,
  FileText,
  CreditCard,
  Truck,
  HardHat,
  Users,
};

interface EmployerContactWithDetails extends EmployerContact {
  contact: Contact;
  employer: Employer;
  contactType?: {
    id: string;
    name: string;
    description: string | null;
    data?: { icon?: string } | null;
  } | null;
}

export default function AllEmployerContacts() {
  const { toast } = useToast();
  const [employerFilter, setEmployerFilter] = useState<string>("all");
  const [contactNameFilter, setContactNameFilter] = useState<string>("");
  const [contactTypeFilter, setContactTypeFilter] = useState<string>("all");
  const [debouncedContactName, setDebouncedContactName] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectingAll, setIsSelectingAll] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedContactName(contactNameFilter);
    }, 300);

    return () => clearTimeout(timer);
  }, [contactNameFilter]);

  const filters = useMemo(() => ({
    ...(employerFilter && employerFilter !== "all" && { employerId: employerFilter }),
    ...(debouncedContactName && { contactName: debouncedContactName }),
    ...(contactTypeFilter && contactTypeFilter !== "all" && { contactTypeId: contactTypeFilter }),
  }), [employerFilter, debouncedContactName, contactTypeFilter]);

  // Reset selection whenever the effective filter set changes so users can never
  // accidentally bulk-message recipients that no longer match their current filters.
  const filterSignature = useMemo(() => JSON.stringify(filters), [filters]);
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterSignature]);

  const queryKey = useMemo(() => ["/api/employer-contacts", filters], [filters]);

  const { data: employerContacts, isLoading } = useQuery<EmployerContactWithDetails[]>({
    queryKey,
  });

  const { data: employers } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: contactTypes } = useQuery<EmployerContactType[]>({
    queryKey: ["/api/options/employer-contact-type"],
  });

  const handleClearFilters = () => {
    setEmployerFilter("all");
    setContactNameFilter("");
    setContactTypeFilter("all");
    setSelectedIds(new Set());
  };

  const visibleContactIds = useMemo(
    () => (employerContacts ?? []).map(ec => ec.contact.id).filter((id): id is string => !!id),
    [employerContacts],
  );

  const allVisibleSelected = visibleContactIds.length > 0 && visibleContactIds.every(id => selectedIds.has(id));
  const visibleSelectedCount = visibleContactIds.filter(id => selectedIds.has(id)).length;
  const totalMatching = employerContacts?.length ?? 0;

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of visibleContactIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSelectAllMatching = useCallback(async () => {
    setIsSelectingAll(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
      });
      const res = await apiRequest("GET", `/api/employer-contacts/all-ids?${params.toString()}`);
      setSelectedIds(new Set(res.contactIds));
      toast({
        title: "Selected all matching contacts",
        description: `${res.total.toLocaleString()} recipient${res.total === 1 ? "" : "s"} selected.`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to select all",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSelectingAll(false);
    }
  }, [filters, toast]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100" data-testid="text-page-title">
            Employer Contacts
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            View and manage all employer contact relationships
          </p>
        </div>
        <ListBulkAction
          selectedContactIds={Array.from(selectedIds)}
          totalMatching={totalMatching}
          visibleSelectedCount={visibleSelectedCount}
          onSelectAllMatching={handleSelectAllMatching}
          isSelectingAllMatching={isSelectingAll}
          sourceLabel="Employer Contacts"
          testIdPrefix="employer-contacts-bulk-action"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Employer
              </label>
              <Select
                value={employerFilter}
                onValueChange={setEmployerFilter}
              >
                <SelectTrigger data-testid="select-employer-filter">
                  <SelectValue placeholder="All employers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employers</SelectItem>
                  {employers?.map((employer) => (
                    <SelectItem key={employer.id} value={employer.id}>
                      {employer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Contact Name
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search by name or email..."
                  value={contactNameFilter}
                  onChange={(e) => setContactNameFilter(e.target.value)}
                  className="pl-10"
                  data-testid="input-contact-name-filter"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Contact Type
              </label>
              <Select
                value={contactTypeFilter}
                onValueChange={setContactTypeFilter}
              >
                <SelectTrigger data-testid="select-contact-type-filter">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {contactTypes?.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={handleClearFilters}
                className="w-full"
                data-testid="button-clear-filters"
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Results
            {employerContacts && (
              <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                ({employerContacts.length} {employerContacts.length === 1 ? 'contact' : 'contacts'}
                {selectedIds.size > 0 && `, ${selectedIds.size} selected`})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : employerContacts && employerContacts.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(checked) => toggleAllVisible(!!checked)}
                        data-testid="checkbox-select-all-employer-contacts"
                      />
                    </TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead>Contact Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Contact Type</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employerContacts.map((ec) => {
                    const cid = ec.contact.id;
                    const isSelected = !!cid && selectedIds.has(cid);
                    return (
                    <TableRow key={ec.id} data-testid={`row-employer-contact-${ec.id}`}>
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          disabled={!cid}
                          onCheckedChange={(checked) => cid && toggleOne(cid, !!checked)}
                          data-testid={`checkbox-select-employer-contact-${ec.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/employers/${ec.employerId}`}>
                          <span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                            {ec.employer.name}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>{ec.contact.displayName || "—"}</TableCell>
                      <TableCell>{ec.contact.email || "—"}</TableCell>
                      <TableCell>
                        {ec.contactType ? (
                          <div className="flex items-center gap-2">
                            {(() => {
                              const iconName = ec.contactType.data?.icon;
                              const IconComponent = iconName && iconMap[iconName] ? iconMap[iconName] : User;
                              return <IconComponent className="h-4 w-4 text-muted-foreground" />;
                            })()}
                            <span>{ec.contactType.name}</span>
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/employer-contacts/${ec.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-view-${ec.id}`}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );})}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400" data-testid="text-no-results">
                No employer contacts found. {(employerFilter !== "all" || debouncedContactName || contactTypeFilter !== "all") && "Try adjusting your filters."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
