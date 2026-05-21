import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, CalendarCheck, DollarSign, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { DashboardPluginProps } from "../types";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface ShopSummary {
  employerId: string;
  employerName: string;
  latestWizard: {
    type: string;
    year: number;
    month: number;
    completedAt: string | null;
  } | null;
  accounts: Array<{
    accountId: string;
    accountName: string;
    balance: string;
  }>;
}

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatBalance(balance: string): string {
  const num = parseFloat(balance);
  if (isNaN(num)) return "$0.00";
  const sign = num < 0 ? "-" : "";
  return `${sign}$${Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MyShopsPlugin({ userPermissions }: DashboardPluginProps) {
  const hasAccess = userPermissions.includes("employer");

  const { data: shops, isLoading, error } = useQuery<ShopSummary[]>({
    queryKey: ["/api/dashboard-plugins/my-shops"],
    enabled: hasAccess,
  });

  if (!hasAccess) return null;

  if (isLoading) {
    return (
      <Card data-testid="plugin-my-shops" className="col-span-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            My Shops
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !shops || shops.length === 0) return null;

  return (
    <Card data-testid="plugin-my-shops" className="col-span-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          My Shops
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {shops.map((shop) => {
            const totalBalance = shop.accounts.reduce(
              (sum, a) => sum + parseFloat(a.balance || "0"),
              0
            );
            return (
              <div
                key={shop.employerId}
                className="py-3 first:pt-0 last:pb-0"
                data-testid={`shop-${shop.employerId}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Link
                    href={`/employers/${shop.employerId}`}
                    className="font-medium text-primary hover:underline flex items-center gap-1"
                  >
                    {shop.employerName}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div className="flex items-start gap-2">
                    <CalendarCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    {shop.latestWizard ? (
                      <div>
                        <span className="text-muted-foreground">Last upload: </span>
                        <span>
                          {monthNames[shop.latestWizard.month - 1]} {shop.latestWizard.year}
                        </span>
                        {shop.latestWizard.completedAt && (
                          <span className="text-muted-foreground ml-1">
                            ({new Date(shop.latestWizard.completedAt).toLocaleDateString()})
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No uploads yet</span>
                    )}
                  </div>

                  <div className="flex items-start gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    {shop.accounts.length > 0 ? (
                      <div>
                        <span className="text-muted-foreground">Balance: </span>
                        <span className={totalBalance < 0 ? "text-destructive font-medium" : ""}>
                          {formatBalance(totalBalance.toString())}
                        </span>
                        {shop.accounts.length > 1 && (
                          <Badge variant="secondary" className="ml-1 text-xs">
                            {shop.accounts.length} accounts
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No accounts</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
