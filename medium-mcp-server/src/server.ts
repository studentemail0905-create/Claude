import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerPublishTools } from "./tools/publish.js";
import type { ToolContext } from "./tools/context.js";

export const SERVER_NAME = "medium-mcp-server";
export const SERVER_VERSION = "1.0.0";

/**
 * Builds a fresh McpServer instance wired to the given tool context, with
 * tool groups registered according to the read/write/publish feature flags.
 * A new instance should be created per transport connection (see index.ts).
 */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { logging: {}, tools: {} },
      instructions:
        "Authenticated MCP server for a single Medium account. Read tools (get_profile, " +
        "list_publications, list_articles, get_article) are safe to call freely. create_draft writes a " +
        "private draft. Publishing is a two-step, explicitly confirmed flow: call " +
        "request_publish_confirmation first, show the returned summary to the user, then call " +
        "publish_article with the returned confirmationToken. Never call publish_article without a " +
        "confirmationToken obtained moments earlier from request_publish_confirmation in the same " +
        "conversation.",
    }
  );

  if (ctx.config.MEDIUM_ENABLE_READ_TOOLS) {
    registerReadTools(server, ctx);
  }
  if (ctx.config.MEDIUM_ENABLE_WRITE_TOOLS) {
    registerWriteTools(server, ctx);
  }
  if (ctx.config.MEDIUM_ENABLE_PUBLISH_TOOL) {
    registerPublishTools(server, ctx);
  }

  ctx.logger.info(
    {
      readTools: ctx.config.MEDIUM_ENABLE_READ_TOOLS,
      writeTools: ctx.config.MEDIUM_ENABLE_WRITE_TOOLS,
      publishTool: ctx.config.MEDIUM_ENABLE_PUBLISH_TOOL,
    },
    "MCP server instance created"
  );

  return server;
}
