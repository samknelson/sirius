import winston from "winston";
import { PostgresTransport } from "@innova2/winston-pg";

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

// Add PostgreSQL transport if DATABASE_URL is available
if (process.env.DATABASE_URL) {
  try {
    const pgTransport = new PostgresTransport({
      connectionString: process.env.DATABASE_URL,
      tableName: "winston_logs",
      level: "info",
      maxPool: 10,
      tableColumns: [
        { name: "id", dataType: "SERIAL", primaryKey: true, unique: true },
        { name: "level", dataType: "VARCHAR(20)" },
        { name: "message", dataType: "TEXT" },
        { name: "timestamp", dataType: "TIMESTAMP DEFAULT NOW()" },
        { name: "source", dataType: "VARCHAR(50)" },
        { name: "meta", dataType: "JSONB" },
      ],
    });
    transports.push(pgTransport);
  } catch (error) {
    console.error("Failed to initialize PostgreSQL transport for Winston:", error);
  }
}

// Create the logger
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
