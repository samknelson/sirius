// Re-export of the shared enrollment signature step so the client component
// registry resolves `life_event_enrollment:SignatureStep`. Signature capture
// is identical for every enrollment-style wizard.
export { SignatureStep } from "@/components/wizards/framework/enrollment/SignatureStep";
