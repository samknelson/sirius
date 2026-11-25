import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import type { DispatchFormProps } from "../../../../client/src/lib/dispatch-contributions";

type Departments = Record<string, { departmentId: string; departmentName: string | null }>;
const DepartmentValues = createContext<Departments>({});
export function DepartmentListProvider({ jobIds, children }: PropsWithChildren<{ jobIds: string[] }>) {
  const key = [...new Set(jobIds)].join(",");
  const { data = {} } = useQuery<Departments>({
    queryKey: ["/api/dispatch-job-departments", { jobIds: key }],
    queryFn: async () => {
      const res = await fetch(`/api/dispatch-job-departments?jobIds=${encodeURIComponent(key)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job departments");
      return res.json();
    },
    enabled: key.length > 0,
  });
  return <DepartmentValues.Provider value={data}>{children}</DepartmentValues.Provider>;
}
export function DepartmentCell({ jobId }: { jobId: string }) {
  const values = useContext(DepartmentValues);
  return <span data-testid={`text-department-${jobId}`}>{values[jobId]?.departmentName || <span className="text-muted-foreground">—</span>}</span>;
}
export function DepartmentCardField({ jobId, recordId }: { jobId: string; recordId: string }) {
  const values = useContext(DepartmentValues);
  const name = values[jobId]?.departmentName;
  if (!name) return null;
  return <div className="flex items-center gap-2">
    <Building2 className="h-4 w-4 text-muted-foreground" />
    <span className="text-muted-foreground">Department:</span>
    <span data-testid={`text-dispatch-department-${recordId}`}>{name}</span>
  </div>;
}
export function DepartmentForm({ recordId, register }: DispatchFormProps) {
  const { toast } = useToast();
  const [selected, setSelected] = useState("");
  const [touched, setTouched] = useState(false);
  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/dispatch-departments/available"] });
  const { data: current, isSuccess } = useQuery<{ departmentId: string } | null>({
    queryKey: ["/api/dispatch-job-departments/job", recordId], enabled: !!recordId,
  });
  useEffect(() => {
    if (isSuccess && !touched) setSelected(current?.departmentId ?? "");
  }, [current, isSuccess, touched]);
  useEffect(() => register("dispatch.department", {
    async afterSave(id) {
      if (recordId ? !touched : !selected) return;
      try {
        await apiRequest("PUT", `/api/dispatch-job-departments/job/${id}`, { departmentId: selected || null });
        queryClient.invalidateQueries({ queryKey: ["/api/dispatch-job-departments/job", id] });
        queryClient.invalidateQueries({ queryKey: ["/api/dispatch-job-departments"] });
      } catch (error) {
        toast({ title: "Warning", description: getApiErrorMessage(error, `The job was ${recordId ? "updated" : "created"} but its department could not be saved.`), variant: "destructive" });
      }
    },
  }), [register, recordId, touched, selected, toast]);
  return <FormItem>
    <FormLabel>Department</FormLabel>
    <Select value={selected || "__none__"} onValueChange={value => { setTouched(true); setSelected(value === "__none__" ? "" : value); }}>
      <SelectTrigger data-testid="select-department"><SelectValue placeholder="No department" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">No department</SelectItem>
        {departments.map(department => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}
      </SelectContent>
    </Select>
  </FormItem>;
}
export function DepartmentSummary({ job }: { job: { id: string } }) {
  const { data } = useQuery<{ departmentId: string; department?: { id: string; name: string } | null } | null>({ queryKey: ["/api/dispatch-job-departments/job", job.id] });
  return <div><h3 className="text-sm font-medium text-muted-foreground mb-1">Department</h3><p className="text-foreground" data-testid="text-department">{data?.department?.name || "No department"}</p></div>;
}
