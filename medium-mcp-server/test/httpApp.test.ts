import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildHttpApp } from "../src/httpApp.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { ConfirmationStore } from "../src/confirmationStore.js";
import { createFakeMediumClient, createFakeRssClient } from "./testHarness.js";
import type { ToolContext } from "../src/tools/context.js";

function buildCtx(overrides: Record<string, string> = {}): ToolContext {
  const config = loadConfig({
    MEDIUM_INTEGRATION_TOKEN: "test-token",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    ...overrides,
  } as NodeJS.ProcessEnv);
  const logger = createLogger(config);
  return {
    mediumClient: createFakeMediumClient(),
    rssClient: createFakeRssClient(),
    confirmationStore: new ConfirmationStore(config.MEDIUM_PUBLISH_CONFIRMATION_TTL_MS),
    logger,
    config,
  };
}

describe("HTTP transport", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server!.close(resolve));
      server = undefined;
    }
  });

  it("GET /healthz responds without authentication even when an auth token is configured", async () => {
    const app = buildHttpApp(buildCtx({ MCP_SERVER_AUTH_TOKEN: "s3cr3t" }));
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("rejects /mcp requests with no Authorization header when a server auth token is configured", async () => {
    const app = buildHttpApp(buildCtx({ MCP_SERVER_AUTH_TOKEN: "s3cr3t" }));
    const res = await request(app).post("/mcp").send({});
    expect(res.status).toBe(401);
  });

  it("rejects /mcp requests with the wrong bearer token", async () => {
    const app = buildHttpApp(buildCtx({ MCP_SERVER_AUTH_TOKEN: "s3cr3t" }));
    const res = await request(app).post("/mcp").set("Authorization", "Bearer wrong-token").send({});
    expect(res.status).toBe(401);
  });

  it("allows a full MCP session over HTTP with a valid bearer token", async () => {
    const app = buildHttpApp(buildCtx({ MCP_SERVER_AUTH_TOKEN: "s3cr3t" }));
    server = app.listen(0);
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected an ephemeral TCP address");
    const baseUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);

    const transport = new StreamableHTTPClientTransport(baseUrl, {
      requestInit: { headers: { Authorization: "Bearer s3cr3t" } },
    });
    const client = new Client({ name: "http-test-client", version: "1.0.0" });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("get_profile");

    await client.close();
  });

  it("rejects an MCP session over HTTP with an invalid bearer token", async () => {
    const app = buildHttpApp(buildCtx({ MCP_SERVER_AUTH_TOKEN: "s3cr3t" }));
    server = app.listen(0);
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected an ephemeral TCP address");
    const baseUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);

    const transport = new StreamableHTTPClientTransport(baseUrl, {
      requestInit: { headers: { Authorization: "Bearer wrong" } },
    });
    const client = new Client({ name: "http-test-client", version: "1.0.0" });
    await expect(client.connect(transport)).rejects.toThrow();
  });
});
