import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
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
  Download,
  type LucideIcon 
} from "lucide-react";
import { stringify } from "csv-stringify/browser/esm/sync";
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
  const [employerFilter, setEmployerFilter] = useState<string>("all");
  const [contactNameFilter, setContactNameFilter] = useState<string>("");
  const [contactTypeFilter, setContactTypeFilter] = useState<string>("all");
  const [debouncedContactName, setDebouncedContactName] = useState<string>("");

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
  };

  const downloadCsv = (csvString: string, filename: string) => {
    const blob = new Blob([csvString], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    if (!employerContacts?.length) return;

    const csvData = employerContacts.map(ec => ({
      "Employer": ec.employer.name,
      "Contact Type": ec.contactType?.name || "",
      "Display Name": ec.contact.displayName || "",
      "Title": ec.contact.title || "",
      "First Name": ec.contact.given || "",
      "Middle Name": ec.contact.middle || "",
      "Last Name": ec.contact.family || "",
      "Generational": ec.contact.generational || "",
      "Credentials": ec.contact.credentials || "",
      "Email": ec.contact.email || "",
    }));

    const csv = stringify(csvData, { header: true });
    downloadCsv(csv, `employer-contacts-${new Date().toISOString().split("T")[0]}.csv`);
  };

  const handleExportByContact = () => {
    if (!employerContacts?.length) return;

    const grouped = new Map<string, {
      contact: EmployerContactWithDetails["contact"];
      contactTypes: Set<string>;
      employers: string[];
    }>();

    for (const ec of employerContacts) {
      const key = ec.contact.id;
      if (!grouped.has(key)) {
        grouped.set(key, {
          contact: ec.contact,
          contactTypes: new Set(),
          employers: [],
        });
      }
      const entry = grouped.get(key)!;
      entry.employers.push(ec.employer.name);
      if (ec.contactType?.name) {
        entry.contactTypes.add(ec.contactType.name);
      }
    }

    const csvData = Array.from(grouped.values()).map(({ contact, contactTypes, employers }) => ({
      "Display Name": contact.displayName || "",
      "Title": contact.title || "",
      "First Name": contact.given || "",
      "Middle Name": contact.middle || "",
      "Last Name": contact.family || "",
      "Generational": contact.generational || "",
      "Credentials": contact.credentials || "",
      "Email": contact.email || "",
      "Contact Types": Array.from(contactTypes).join(", "),
      "Employers": employers.join(", "),
    }));

    const csv = stringify(csvData, { header: true });
    downloadCsv(csv, `contacts-by-employer-${new Date().toISOString().split("T")[0]}.csv`);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100" data-testid="text-page-title">
            Employer Contacts
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            View and manage all employer contact relationships
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExportByContact}
            disabled={!employerContacts?.length}
            data-testid="button-export-by-contact"
          >
            <Download className="h-4 w-4 mr-2" />
            Export by Contact
          </Button>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={!employerContacts?.length}
            data-testid="button-export-csv"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
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
                ({employerContacts.length} {employerContacts.length === 1 ? 'contact' : 'contacts'})
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
                    <TableHead>Employer</TableHead>
                    <TableHead>Contact Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Contact Type</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employerContacts.map((ec) => (
                    <TableRow key={ec.id} data-testid={`row-employer-contact-${ec.id}`}>
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
                  ))}
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
