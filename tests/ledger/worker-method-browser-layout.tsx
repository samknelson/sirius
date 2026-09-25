import type { ReactNode } from "react";

export const WorkerLayout = ({ children }: { children: ReactNode }) => <main>{children}</main>;
export const useWorkerLayout = () => ({ worker: { id: "fixture-worker" } });