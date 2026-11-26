import { BookmarkButton } from "./components/ui/bookmark-button";

export function WorkerButton({ workerId, entityName }: { workerId: string; entityName?: string }) {
  return <BookmarkButton entityType="worker" entityId={workerId} entityName={entityName} />;
}
export function EmployerButton({ employerId, entityName }: { employerId: string; entityName?: string }) {
  return <BookmarkButton entityType="employer" entityId={employerId} entityName={entityName} />;
}
export function CompanyButton({ companyId, entityName }: { companyId: string; entityName?: string }) {
  return <BookmarkButton entityType="company" entityId={companyId} entityName={entityName} />;
}
