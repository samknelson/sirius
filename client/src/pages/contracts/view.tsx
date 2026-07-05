import { FileText, Layers, List } from "lucide-react";
import { ContractLayout, useContractLayout } from "@/components/layouts/ContractLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function DetailsBody() {
  const { contract } = useContractLayout();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Articles</CardTitle>
            <Layers size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="stat-article-count">
              {contract.articleCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sections</CardTitle>
            <List size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="stat-section-count">
              {contract.sectionCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Stub sections</CardTitle>
            <FileText size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant={contract.stubSections ? "default" : "secondary"} data-testid="badge-stub-sections">
              {contract.stubSections ? "Enabled" : "Disabled"}
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ContractViewPage() {
  return (
    <ContractLayout activeTab="details">
      <DetailsBody />
    </ContractLayout>
  );
}
