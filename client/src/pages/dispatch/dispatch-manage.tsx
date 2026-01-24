import { useState } from "react";
import { DispatchLayout, useDispatchLayout } from "@/components/layouts/DispatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Save, Settings } from "lucide-react";
import { dispatchStatusEnum } from "@shared/schema";

const statusLabels: Record<string, string> = {
  requested: "Requested",
  pending: "Pending",
  notified: "Notified",
  accepted: "Accepted",
  layoff: "Layoff",
  resigned: "Resigned",
  declined: "Declined",
};

function DispatchManageContent() {
  const { dispatch } = useDispatchLayout();
  const [selectedStatus, setSelectedStatus] = useState(dispatch.status);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="title-manage-section">
            <Settings className="h-5 w-5" />
            Manage Dispatch
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label htmlFor="status-select" data-testid="label-status">Status</Label>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger id="status-select" data-testid="select-status">
                <SelectValue placeholder="Select status" data-testid="text-selected-status" />
              </SelectTrigger>
              <SelectContent>
                {dispatchStatusEnum.map((status) => (
                  <SelectItem key={status} value={status} data-testid={`option-status-${status}`}>
                    {statusLabels[status] || status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-4">
            <Button data-testid="button-save">
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DispatchManagePage() {
  return (
    <DispatchLayout activeTab="manage">
      <DispatchManageContent />
    </DispatchLayout>
  );
}
