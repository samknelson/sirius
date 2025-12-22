import winston from "winston";
import { LogsTransport } from "./services/logs-transport";

const isDevelopment = process.env.NODE_ENV === "development";

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "hh:mm:ss A" }),
  winston.format.printf(({ level, message, timestamp, source = "app", ...meta }) => {
    const metaString = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${source}] ${level.toUpperCase()}: ${message}${metaString}`;
  })
);

// Create transports array
const transports: winston.transport[] = [
  // Console transport for development
  new winston.transports.Console({
    level: isDevelopment ? "debug" : "info",
    format: consoleFormat,
  }),
];

// Create the main logger (console only)
export const logger = winston.createLogger({
  level: isDevelopment ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "sirius" },
  transports,
});

// Create storage logger with PostgreSQL transport for storage operations
const storageTransports: winston.transport[] = [
  // Also log to console for visibility during development
  new winston.transports.Console({
    level: isDevelopment ? "info" : "info",
    format: consoleFormat,
  }),
];

// Add custom logs transport for storage operations (writes via logs storage, emits LOG events)
if (process.env.DATABASE_URL) {
  try {
    const logsTransport = new LogsTransport({
      level: "info",
    });
    
    logsTransport.on("error", (error) => {
      console.error("[LogsTransport] Error:", error);
    });
    
    storageTransports.push(logsTransport);
  } catch (error) {
    console.error("Failed to initialize LogsTransport for storage logger:", error);
  }
}

// Storage operations logger - writes to database
export const storageLogger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "sirius", source: "storage" },
  transports: storageTransports,
});

// Helper functions for common logging patterns
export const log = {
  info: (message: string, meta?: Record<string, any>) => logger.info(message, meta),
  error: (message: string, meta?: Record<string, any>) => logger.error(message, meta),
  warn: (message: string, meta?: Record<string, any>) => logger.warn(message, meta),
  debug: (message: string, meta?: Record<string, any>) => logger.debug(message, meta),
  http: (message: string, meta?: Record<string, any>) => logger.http(message, meta),
};

// Export a simple log function that mimics the old behavior
export function simpleLog(message: string, source = "express") {
  logger.info(message, { source });
}

export default logger;
