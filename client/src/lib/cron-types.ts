export interface CronJobRun {
  id: string;
  jobName: string;
  status: string;
  mode: string;
  output: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string | null;
  userFirstName?: string | null;
  userLastName?: string | null;
  userEmail?: string | null;
}

export interface CronJob {
  name: string;
  description: string | null;
  schedule: string;
  isEnabled: boolean;
  settings?: Record<string, unknown> | null;
  defaultSettings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  latestRun?: CronJobRun;
}
