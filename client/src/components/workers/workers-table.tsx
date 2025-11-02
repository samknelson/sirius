import { useState } from "react";
import { ArrowUpDown, User, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Worker } from "@shared/schema";
import { Link } from "wouter";

interface WorkersTableProps {
  workers: Worker[];
  isLoading: boolean;
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

  const sortedWorkers = [...workers].sort((a, b) => {
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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Workers Database</h2>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <ArrowUpDown className="text-muted-foreground" size={16} />
                <span className="text-sm text-muted-foreground">Sort by Name</span>
              </div>
              <span className="text-sm font-medium text-primary" data-testid="text-total-workers">
                {workers.length} Total
              </span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/20">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <div className="flex items-center space-x-2">
                    <span>ID</span>
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
                  <span>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {sortedWorkers.map((worker, index) => (
                <tr key={worker.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-worker-${worker.id}`}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-muted-foreground">
                    {String(index + 1).padStart(3, "0")}
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
                        {worker.name}
                      </span>
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
