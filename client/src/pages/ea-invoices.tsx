import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";

function EAInvoicesContent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>Manage invoices for this account entry</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground" data-testid="text-coming-soon">
            Invoice management coming soon
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EAInvoices() {
  return (
    <EALayout activeTab="invoices">
      <EAInvoicesContent />
    </EALayout>
  );
}
