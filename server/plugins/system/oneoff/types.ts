import type { PluginConfig } from "@shared/schema";
import type { BasePluginMetadata } from "../../_core";
import type { db } from "../../../storage/db";

export interface OneoffPreflightResult {
  message: string;
  rowCount?: number;
  estimatedDurationMs?: number;
}

export interface OneoffProgress {
  phase: string;
  completed: number;
  total: number;
  rowCount: number;
  checkpoint?: unknown;
}

export interface OneoffContext {
  config: PluginConfig;
  action: string;
  input: unknown;
  db?: typeof db;
}

export interface OneoffExecutionContext extends OneoffContext {
  signal: AbortSignal;
  reportProgress(progress: OneoffProgress): Promise<void>;
}

export interface OneoffAction {
  id: "run-once" | "run-batch" | "cleanup" | string;
  label: string;
  description?: string;
  destructive?: boolean;
  background?: boolean;
  preflightDatabaseAccess?: "read-write";
  executeDatabaseAccess?: "read-write";
  preflight(ctx: OneoffContext): Promise<OneoffPreflightResult>;
  execute(ctx: OneoffExecutionContext): Promise<unknown>;
}

export interface OneoffPlugin {
  metadata: BasePluginMetadata;
  actions: OneoffAction[];
  status(ctx: {
    config: PluginConfig;
    db: typeof db;
  }): Promise<{ rowCount: number; tableExists: boolean }>;
}