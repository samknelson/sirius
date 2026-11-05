import { createContext, useContext, useLayoutEffect, useRef } from "react";

/** Opt-in only: all other steps retain completion-based navigation. */
export interface NextSubmission {
  ready: boolean;
  busy?: boolean;
  guidance: string;
  submit: () => Promise<unknown>;
}

export const NextSubmissionContext = createContext<{
  register: (submission: NextSubmission | null) => void;
  navigating: boolean;
} | null>(null);

export function useNextSubmission(submission: NextSubmission, enabled = true) {
  const context = useContext(NextSubmissionContext);
  const latest = useRef(submission.submit);
  latest.current = submission.submit;
  const register = context?.register;
  const { ready, busy, guidance } = submission;
  useLayoutEffect(() => {
    if (!enabled || !register) return;
    register({ ready, busy, guidance, submit: () => latest.current() });
    return () => register(null);
  }, [enabled, register, ready, busy, guidance]);
  return context?.navigating ?? false;
}
