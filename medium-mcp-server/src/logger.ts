import pino from "pino";
import type { AppConfig } from "./config.js";

const REDACT_PATHS = [
  "req.headers.authorization",
  "*.token",
  "*.authorization",
  "*.integrationToken",
  "*.confirmationToken",
  "MEDIUM_INTEGRATION_TOKEN",
  "MCP_SERVER_AUTH_TOKEN",
];

export function createLogger(cfg: Pick<AppConfig, "LOG_LEVEL" | "LOG_PRETTY">) {
  return pino({
    level: cfg.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    transport: cfg.LOG_PRETTY
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
      : undefined,
    base: { service: "medium-mcp-server" },
  });
}

export type Logger = ReturnType<typeof createLogger>;
