import { useCallback, useRef, type ComponentType, type PropsWithChildren, type ReactNode } from "react";
import { componentBrowserContributions } from "../generated/component-contributions";
import { useAuth } from "../contexts/AuthContext";
import type { DispatchJob, JobTypeData } from "@shared/schema";

export interface DispatchFormParticipant {
  validate?: () => string | null;
  prepareData?: (data: Record<string, unknown>) => Record<string, unknown>;
  afterSave?: (id: string) => Promise<void>;
}
export type RegisterDispatchForm = (id: string, participant: DispatchFormParticipant) => () => void;
export interface DispatchFormProps {
  recordId?: string;
  data?: unknown;
  jobTypeData?: JobTypeData;
  register: RegisterDispatchForm;
}
export interface DispatchUiContribution {
  component: string;
  jobForm?: ComponentType<DispatchFormProps>;
  jobSettings?: ComponentType<DispatchFormProps>;
  jobTypeForm?: ComponentType<DispatchFormProps>;
  jobDetail?: ComponentType<{ job: DispatchJob; jobTypeData?: JobTypeData }>;
  jobSummary?: ComponentType<{ job: DispatchJob; jobTypeData?: JobTypeData }>;
  workerStatus?: ComponentType<{ workerId: string }>;
  jobListColumn?: {
    id: string;
    title: string;
    provider: ComponentType<PropsWithChildren<{ jobIds: string[] }>>;
    cell: ComponentType<{ jobId: string }>;
    cardField?: ComponentType<{ jobId: string; recordId: string }>;
  };
}
export function useDispatchForm() {
  const participants = useRef(new Map<string, DispatchFormParticipant>());
  const register: RegisterDispatchForm = useCallback((id, participant) => {
    if (participants.current.has(id)) throw new Error(`Duplicate dispatch form participant: ${id}`);
    participants.current.set(id, participant);
    return () => { participants.current.delete(id); };
  }, []);
  return {
    register,
    prepareData(data: unknown): Record<string, unknown> {
      let prepared = { ...(data && typeof data === "object" ? data as Record<string, unknown> : {}) };
      for (const participant of participants.current.values()) {
        const error = participant.validate?.();
        if (error) throw new Error(error);
        prepared = participant.prepareData?.(prepared) ?? prepared;
      }
      return prepared;
    },
    async afterSave(id: string): Promise<void> {
      for (const participant of participants.current.values()) await participant.afterSave?.(id);
    },
  };
}
export function useDispatchUi(): DispatchUiContribution[] {
  const { hasComponent } = useAuth();
  return componentBrowserContributions.flatMap(p => p.dispatchUi ?? []).filter(p => hasComponent(p.component));
}
export function DispatchFormExtensions({ slot, ...props }: DispatchFormProps & { slot: "jobForm" | "jobSettings" | "jobTypeForm" }) {
  return <>{useDispatchUi().map(contribution => {
    const View = contribution[slot];
    return View ? <View key={contribution.component} {...props} /> : null;
  })}</>;
}
export function DispatchJobDetailsExtensions({ slot = "jobDetail", ...props }: { job: DispatchJob; jobTypeData?: JobTypeData; slot?: "jobDetail" | "jobSummary" }) {
  return <>{useDispatchUi().map(contribution => {
    const View = contribution[slot];
    return View ? <View key={contribution.component} {...props} /> : null;
  })}</>;
}
export function WorkerDispatchExtensions(props: { workerId: string }) {
  return <>{useDispatchUi().map(contribution => {
    const View = contribution.workerStatus;
    return View ? <View key={contribution.component} {...props} /> : null;
  })}</>;
}
export function DispatchListProviders({ columns, jobIds, children }: PropsWithChildren<{ columns: NonNullable<DispatchUiContribution["jobListColumn"]>[]; jobIds: string[] }>) {
  return columns.reduceRight<ReactNode>((content, column) => {
    const Provider = column.provider;
    return <Provider key={column.id} jobIds={jobIds}>{content}</Provider>;
  }, children);
}
