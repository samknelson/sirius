/**
 * SQL Prettifier utility for formatting SQL queries for display.
 * Uses the sql-formatter library for robust formatting.
 */

import { format } from "sql-formatter";

/**
 * Formats a SQL query string for better readability.
 * Uses full formatting with proper indentation for nested structures.
 *
 * @param sql - The SQL query string to format
 * @returns The formatted SQL string
 */
export function prettifySql(sql: string): string {
  if (!sql || typeof sql !== "string") {
    return sql || "";
  }

  try {
    return format(sql, {
      language: "postgresql",
      tabWidth: 2,
      keywordCase: "upper",
      expressionWidth: 60,
      logicalOperatorNewline: "before",
    });
  } catch {
    return sql;
  }
}

/**
 * A simpler SQL formatter with wider expression width.
 * Better for more compact display while still being readable.
 */
export function prettifySqlSimple(sql: string): string {
  if (!sql || typeof sql !== "string") {
    return sql || "";
  }

  try {
    return format(sql, {
      language: "postgresql",
      tabWidth: 2,
      keywordCase: "upper",
      expressionWidth: 80,
      logicalOperatorNewline: "before",
    });
  } catch {
    return sql;
  }
}
