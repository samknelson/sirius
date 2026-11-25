export const jobTypeBullpenEnum = ["none", "host", "shared"] as const;
export type JobTypeBullpenSetting = typeof jobTypeBullpenEnum[number];
declare module "../../../shared/schema/dispatch/eligibility-config" {
  interface JobTypeData { bullpen?: JobTypeBullpenSetting; bullpenEventTypeId?: string }
}
