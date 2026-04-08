import { useState, useMemo } from "react";
import { Building, Plus, Eye, Search } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { type Company } from "@shared/schema/employer/company-schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function Companies() {
  usePageTitle("Companies");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const filteredCompanies = useMemo(() => {
    if (!searchQuery) return companies;
    const query = searchQuery.toLowerCase();
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.siriusId.toLowerCase().includes(query) ||
        (c.description && c.description.toLowerCase().includes(query))
    );
  }, [companies, searchQuery]);

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="Companies"
        icon={<Building className="text-primary-foreground" size={16} />}
        actions={
          <span className="text-sm text-muted-foreground" data-testid="text-company-count">
            {companies.length} {companies.length === 1 ? "Company" : "Companies"}
          </span>
        }
      />

      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            <Link href="/companies">
              <Button variant="default" size="sm" data-testid="tab-companies-list">
                List
              </Button>
            </Link>
            <Link href="/companies/add">
              <Button variant="outline" size="sm" data-testid="tab-companies-add">
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-8" data-testid="loading-companies">
            <p>Loading companies...</p>
          </div>
        ) : (
          <Card className="shadow-sm">
            <div className="px-6 py-4 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={16} />
                <Input
                  placeholder="Search companies..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-companies"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-companies">
                <thead className="bg-muted/20">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Sirius ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredCompanies.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground" data-testid="text-no-companies">
                        {searchQuery ? "No companies match your search." : "No companies found."}
                      </td>
                    </tr>
                  ) : (
                    filteredCompanies.map((company) => (
                      <tr key={company.id} className="hover:bg-muted/30" data-testid={`row-company-${company.id}`}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-3">
                            <Building size={16} className="text-muted-foreground" />
                            <span className="text-sm font-medium">{company.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-muted-foreground">{company.siriusId}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-muted-foreground line-clamp-1">
                            {company.description || "—"}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Link href={`/companies/${company.id}`}>
                            <Button variant="ghost" size="sm" data-testid={`button-view-company-${company.id}`}>
                              <Eye size={14} className="mr-1" />
                              View
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
