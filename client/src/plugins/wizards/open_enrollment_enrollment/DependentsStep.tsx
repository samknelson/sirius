// Re-export of the shared enrollment step so the client component registry
// resolves `open_enrollment_enrollment:DependentsStep`. The implementation
// lives in the shared enrollment framework folder and is reused by every
// enrollment-style wizard (First-time and Open Enrollment).
export { DependentsStep } from "@/components/wizards/framework/enrollment/DependentsStep";
