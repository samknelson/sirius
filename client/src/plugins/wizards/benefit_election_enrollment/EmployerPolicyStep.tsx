// Re-export of the shared enrollment step so the client component registry
// resolves `benefit_election_enrollment:EmployerPolicyStep`. The implementation lives in the
// shared enrollment framework folder and is reused by every enrollment-style
// wizard (First-time, and future Life Event / Open Enrollment).
export { EmployerPolicyStep } from "@/components/wizards/framework/enrollment/EmployerPolicyStep";
