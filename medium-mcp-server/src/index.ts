import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { MediumClient } from "./mediumClient.js";
import { RssClient } from "./rssClient.js";
import { ConfirmationStore } from "./confirmationStore.js";
import { createMcpServer } from "./server.js";
import { buildHttpApp } from "./httpApp.js";
import type { ToolContext } from "./tools/context.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const mediumClient = new MediumClient({
    baseUrl: config.MEDIUM_API_BASE_URL,
    integrationToken: config.MEDIUM_INTEGRATION_TOKEN,
    timeoutMs: config.MEDIUM_REQUEST_TIMEOUT_MS,
    logger,
  });

  const rssClient = new RssClient({
    baseUrl: config.MEDIUM_RSS_BASE_URL,
    timeoutMs: config.MEDIUM_REQUEST_TIMEOUT_MS,
    logger,
  });

  const confirmationStore = new ConfirmationStore(config.MEDIUM_PUBLISH_CONFIRMATION_TTL_MS);

  const ctx: ToolContext = { mediumClient, rssClient, confirmationStore, logger, config };

  if (config.MCP_TRANSPORT === "stdio") {
    const server = createMcpServer(ctx);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("medium-mcp-server listening on stdio");
    return;
  }

  const app = buildHttpApp(ctx);
  const httpServer = app.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, () => {
    logger.info(
      { host: config.MCP_HTTP_HOST, port: config.MCP_HTTP_PORT },
      `medium-mcp-server listening on http://${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}/mcp`
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error starting medium-mcp-server:", err);
  process.exit(1);
});
