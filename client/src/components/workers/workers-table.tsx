import { useState, useMemo } from "react";
import { ArrowUpDown, User, Eye, Search, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Worker, Contact, PhoneNumber } from "@shared/schema";
import { formatSSN } from "@shared/schema";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { parsePhoneNumber } from "libphonenumber-js";

interface WorkersTableProps {
  workers: Worker[];
  isLoading: boolean;
}

interface WorkerWithContact extends Worker {
  contactName?: string;
  email?: string;
  phoneNumber?: string;
  employers?: EmployerInfo[];
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

export function WorkersTable({ workers, isLoading }: WorkersTableProps) {
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch contacts for all workers
  const contactIds = workers.map(w => w.contactId);
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", contactIds],
    queryFn: async () => {
      // Fetch contacts individually for now - could be optimized with a batch endpoint
      const contactPromises = contactIds.map(async (id) => {
        const res = await fetch(`/api/contacts/${id}`);
        if (res.ok) {
          return res.json();
        }
        return null;
      });
      const results = await Promise.all(contactPromises);
      return results.filter((c): c is Contact => c !== null);
    },
    enabled: contactIds.length > 0,
  });

  // Fetch phone numbers for all contacts
  const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/contacts/phone-numbers", contactIds],
    queryFn: async () => {
      const phonePromises = contactIds.map(async (contactId) => {
        const res = await fetch(`/api/contacts/${contactId}/phone-numbers`);
        if (res.ok) {
          return res.json();
        }
        return [];
      });
      const results = await Promise.all(phonePromises);
      return results.flat();
    },
    enabled: contactIds.length > 0,
  });

  // Fetch worker-employer summary
  const { data: workerEmployers = [] } = useQuery<WorkerEmployerSummary[]>({
    queryKey: ["/api/workers/employers/summary"],
    enabled: workers.length > 0,
  });

  // Create maps for contact data
  const contactMap = new Map(contacts.map(c => [c.id, c]));
  const phoneMap = new Map<string, PhoneNumber>();
  
  // Map primary phone numbers to contacts
  phoneNumbers.forEach(phone => {
    if (phone.isPrimary && !phoneMap.has(phone.contactId)) {
      phoneMap.set(phone.contactId, phone);
    }
  });
  
  // If no primary, use first phone number
  phoneNumbers.forEach(phone => {
    if (!phoneMap.has(phone.contactId)) {
      phoneMap.set(phone.contactId, phone);
    }
  });

  // Create map for worker employers
  const employerMap = new Map(workerEmployers.map(we => [we.workerId, we.employers]));

  // Add contact names and details to workers
  const workersWithNames: WorkerWithContact[] = workers.map(worker => {
    const contact = contactMap.get(worker.contactId);
    const phone = phoneMap.get(worker.contactId);
    const employers = employerMap.get(worker.id) || [];
    
    let formattedPhone = '';
    if (phone?.phoneNumber) {
      try {
        const parsed = parsePhoneNumber(phone.phoneNumber, 'US');
        formattedPhone = parsed ? parsed.formatNational() : phone.phoneNumber;
      } catch {
        formattedPhone = phone.phoneNumber;
      }
    }
    
    return {
      ...worker,
      contactName: contact?.displayName || 'Unknown',
      email: contact?.email || '',
      phoneNumber: formattedPhone,
      employers,
    };
  });

  // Filter workers based on search query
  const filteredWorkers = useMemo(() => {
    if (!searchQuery.trim()) return workersWithNames;
    
    const query = searchQuery.toLowerCase();
    return workersWithNames.filter(worker => {
      const name = (worker.contactName || '').toLowerCase();
      const email = (worker.email || '').toLowerCase();
      const phone = (worker.phoneNumber || '').toLowerCase();
      const ssn = formatSSN(worker.ssn).toLowerCase();
      
      return name.includes(query) || 
             email.includes(query) || 
             phone.includes(query) || 
             ssn.includes(query);
    });
  }, [workersWithNames, searchQuery]);

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
          
          {/* Search Input */}
          <div className="relative">
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
