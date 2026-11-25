/** Absent/true allows EBA workers; false requires Available on a "both" job. */
declare module "../../../shared/schema/dispatch/eligibility-config" {
  interface DispatchJobData { allowEbaWorkers?: boolean }
}
export {};
