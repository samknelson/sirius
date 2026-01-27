import { useQuery } from "@tanstack/react-query";

interface EdlsTask {
  id: string;
  name: string;
  departmentId: string;
}

interface Department {
  id: string;
  name: string;
}

export interface EnrichedEdlsTask extends EdlsTask {
  departmentName: string;
}

export function useEdlsTasks() {
  const tasksQuery = useQuery<EdlsTask[]>({
    queryKey: ["/api/edls/tasks/options"],
  });

  const departmentsQuery = useQuery<Department[]>({
    queryKey: ["/api/options/department"],
  });

  const isLoading = tasksQuery.isLoading || departmentsQuery.isLoading;
  const isError = tasksQuery.isError || departmentsQuery.isError;

  const enrichedTasks: EnrichedEdlsTask[] = (() => {
    if (!tasksQuery.data || !departmentsQuery.data) return [];
    
    const departmentMap = new Map(
      departmentsQuery.data.map(d => [d.id, d.name])
    );
    
    return tasksQuery.data.map(task => ({
      ...task,
      departmentName: departmentMap.get(task.departmentId) || "Unknown",
    }));
  })();

  return {
    tasks: enrichedTasks,
    rawTasks: tasksQuery.data || [],
    departments: departmentsQuery.data || [],
    isLoading,
    isError,
  };
}

export function useEdlsTasksByDepartment(departmentId: string | undefined) {
  const { tasks, isLoading, isError } = useEdlsTasks();
  
  const filteredTasks = departmentId
    ? tasks.filter(task => task.departmentId === departmentId)
    : [];
  
  return {
    tasks: filteredTasks,
    isLoading,
    isError,
  };
}
