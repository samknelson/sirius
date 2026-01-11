import Transport from "winston-transport";
import { createLogsStorage, type LogInsertData } from "../storage/logs";

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
  [key: string]: unknown;
}

export class LogsTransport extends Transport {
  private logsStorage = createLogsStorage();

  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  async log(info: LogsTransportInfo, callback: () => void): Promise<void> {
    // Debug: log that this transport is being invoked
    console.log(`[LogsTransport] log() called with module=${info.module}, operation=${info.operation}`);
    
    setImmediate(() => {
      this.emit("logged", info);
    });

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

      console.log(`[LogsTransport] About to write to storage: ${message}`);
      await this.logsStorage.create(data);
      console.log(`[LogsTransport] Successfully wrote log to storage`);
    } catch (error) {
      console.error("[LogsTransport] Failed to write log:", error);
    }

    callback();
  }
}
