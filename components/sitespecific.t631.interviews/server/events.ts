import { registerComponentEvent } from "../../../server/services/event-bus";

export interface SitespecificT631InterviewSavedPayload {
  interviewId: string;
  workerId: string;
  jobId: string;
  status: string;
  /** Null on create; the previous status on update/delete. */
  previousStatus: string | null;
  isDeleted: boolean;
}
declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap {
    "sitespecific.t631.interview.saved": SitespecificT631InterviewSavedPayload;
  }
}
export const T631_INTERVIEW_SAVED = registerComponentEvent("sitespecific.t631.interview.saved");
