import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnv = { MEDIUM_INTEGRATION_TOKEN: "abc123" } as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("loads sensible defaults with only the required token set", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.MEDIUM_API_BASE_URL).toBe("https://api.medium.com/v1");
    expect(cfg.MCP_TRANSPORT).toBe("http");
    expect(cfg.MCP_HTTP_PORT).toBe(3000);
    expect(cfg.MEDIUM_ENABLE_READ_TOOLS).toBe(true);
    expect(cfg.MEDIUM_ENABLE_WRITE_TOOLS).toBe(true);
    expect(cfg.MEDIUM_ENABLE_PUBLISH_TOOL).toBe(true);
  });

  it("throws when MEDIUM_INTEGRATION_TOKEN is missing", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/MEDIUM_INTEGRATION_TOKEN/);
  });

  it("parses boolean-ish env values for feature toggles", () => {
    const cfg = loadConfig({ ...baseEnv, MEDIUM_ENABLE_PUBLISH_TOOL: "false" } as NodeJS.ProcessEnv);
    expect(cfg.MEDIUM_ENABLE_PUBLISH_TOOL).toBe(false);

    const cfg2 = loadConfig({ ...baseEnv, MEDIUM_ENABLE_PUBLISH_TOOL: "0" } as NodeJS.ProcessEnv);
    expect(cfg2.MEDIUM_ENABLE_PUBLISH_TOOL).toBe(false);

    const cfg3 = loadConfig({ ...baseEnv, MEDIUM_ENABLE_PUBLISH_TOOL: "true" } as NodeJS.ProcessEnv);
    expect(cfg3.MEDIUM_ENABLE_PUBLISH_TOOL).toBe(true);
  });

  it("refuses to start unauthenticated HTTP in production", () => {
    expect(() => loadConfig({ ...baseEnv, NODE_ENV: "production", MCP_TRANSPORT: "http" } as NodeJS.ProcessEnv)).toThrow(
      /MCP_SERVER_AUTH_TOKEN is required/
    );
  });

  it("allows unauthenticated HTTP in production only with explicit opt-out", () => {
    const cfg = loadConfig({
      ...baseEnv,
      NODE_ENV: "production",
      MCP_TRANSPORT: "http",
      MCP_ALLOW_UNAUTHENTICATED: "true",
    } as NodeJS.ProcessEnv);
    expect(cfg.MCP_ALLOW_UNAUTHENTICATED).toBe(true);
  });

  it("does not require an auth token for stdio transport in production", () => {
    expect(() =>
      loadConfig({ ...baseEnv, NODE_ENV: "production", MCP_TRANSPORT: "stdio" } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });
});
