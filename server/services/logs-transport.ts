import Transport from "winston-transport";
import { createLogsStorage, type LogInsertData } from "../storage/system/logs";

const pendingLogWrites = new Set<Promise<void>>();

export async function flushPendingLogWrites(): Promise<void> {
  while (pendingLogWrites.size > 0) {
    await Promise.allSettled([...pendingLogWrites]);
  }
}

interface LogsTransportInfo {
  level: string;
  message: string;
  timestamp?: string;
  source?: string;
  module?: string;
  operation?: string;
  entity_id?: string;
  host_entity_id?: string;
  description?: string;
  user_id?: string;
  user_email?: string;
  ip_address?: string;
  // WS request specific fields (stored in meta)
  method?: string;
  path?: string;
  status?: number;
  duration?: number;
  client_name?: string;
  credential_id?: string;
  config_id?: string;
  config_alias?: string;
  plugin_id?: string;
  ws_operation?: string;
  error_code?: string;
  [key: string]: unknown;
}

export class LogsTransport extends Transport {
  private logsStorage = createLogsStorage();

  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  log(info: LogsTransportInfo, callback: () => void): void {
    setImmediate(() => {
      this.emit("logged", info);
    });

    const write = (async () => {
      try {
        const { level, message, timestamp, source, module, operation,
                entity_id, host_entity_id, description,
                user_id, user_email, ip_address, ...rest } = info;

        const meta = Object.keys(rest).length > 0 ? rest : null;

        const data: LogInsertData = {
          level,
          message,
          source: source || null,
          meta,
          module: module || null,
          operation: operation || null,
          entityId: entity_id || null,
          hostEntityId: host_entity_id || null,
          description: description || null,
          userId: user_id || null,
          userEmail: user_email || null,
          ipAddress: ip_address || null,
        };

        await this.logsStorage.create(data);
      } catch (error) {
        console.error("[LogsTransport] Failed to write log:", error);
      } finally {
        callback();
      }
    })();

    pendingLogWrites.add(write);
    void write.finally(() => pendingLogWrites.delete(write));
  }
}
