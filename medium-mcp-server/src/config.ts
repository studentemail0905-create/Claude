import { z } from "zod";

const boolFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return defaultValue;
      return ["1", "true", "yes", "on"].includes(v.toLowerCase());
    });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Transport: "http" runs the remote Streamable HTTP server, "stdio" runs a local
  // stdio server (useful for Claude Desktop / local debugging).
  MCP_TRANSPORT: z.enum(["http", "stdio"]).default("http"),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3000),
  MCP_HTTP_HOST: z.string().default("0.0.0.0"),

  // Bearer token required on every HTTP request to this server. Required in
  // production unless MCP_ALLOW_UNAUTHENTICATED is explicitly set.
  MCP_SERVER_AUTH_TOKEN: z.string().optional(),
  MCP_ALLOW_UNAUTHENTICATED: boolFromEnv(false),
  MCP_CORS_ORIGIN: z.string().default(""),

  // Medium authentication (self-issued integration token, sent as a Bearer token).
  // See https://github.com/Medium/medium-api-docs#2-authentication
  MEDIUM_INTEGRATION_TOKEN: z.string().min(1, "MEDIUM_INTEGRATION_TOKEN is required"),
  MEDIUM_API_BASE_URL: z.string().url().default("https://api.medium.com/v1"),
  MEDIUM_RSS_BASE_URL: z.string().url().default("https://medium.com"),
  MEDIUM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Feature toggles: separates read access from write/publish access so a
  // deployment can be locked down to read-only, or to read+draft without publish.
  MEDIUM_ENABLE_READ_TOOLS: boolFromEnv(true),
  MEDIUM_ENABLE_WRITE_TOOLS: boolFromEnv(true),
  MEDIUM_ENABLE_PUBLISH_TOOL: boolFromEnv(true),

  // How long a publish confirmation token stays valid before it must be re-requested.
  MEDIUM_PUBLISH_CONFIRMATION_TTL_MS: z.coerce.number().int().positive().default(10 * 60_000),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LOG_PRETTY: boolFromEnv(false),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const cfg = parsed.data;

  if (cfg.NODE_ENV === "production" && cfg.MCP_TRANSPORT === "http" && !cfg.MCP_SERVER_AUTH_TOKEN && !cfg.MCP_ALLOW_UNAUTHENTICATED) {
    throw new Error(
      "MCP_SERVER_AUTH_TOKEN is required when NODE_ENV=production and MCP_TRANSPORT=http. " +
        "Set MCP_ALLOW_UNAUTHENTICATED=true to explicitly opt out (not recommended)."
    );
  }

  return cfg;
}
