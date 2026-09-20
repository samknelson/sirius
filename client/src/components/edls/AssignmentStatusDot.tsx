const statusColors: Record<string, string> = {
  draft: "bg-gray-400",
  request: "bg-yellow-400",
  lock: "bg-green-500",
  reserved: "bg-blue-500",
  trash: "bg-red-500",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  request: "Requested",
  lock: "Scheduled",
  reserved: "Reserved",
  trash: "Trash",
};

export function getAssignmentStatusDotColor(status: string | null): string {
  return status ? statusColors[status] ?? "border border-gray-300 bg-white" : "border border-gray-300 bg-white";
}

export function AssignmentStatusDot({
  status,
  label,
  className = "h-3 w-3",
}: {
  status: string | null;
  label: string;
  className?: string;
}) {
  const statusLabel = status ? statusLabels[status] ?? status : "No assignment";

  return (
    <span
      title={`${label}: ${statusLabel}`}
      aria-label={`${label}: ${statusLabel}`}
      className={`inline-block rounded-full ${className} ${getAssignmentStatusDotColor(status)}`}
    />
  );
}