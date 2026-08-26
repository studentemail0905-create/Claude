import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./server.js";
import type { ToolContext } from "./tools/context.js";
import type { AppConfig } from "./config.js";

/**
 * Builds the Express app that serves the MCP server over the Streamable
 * HTTP transport (POST/GET/DELETE /mcp), per-session, plus a liveness probe
 * at GET /healthz for load balancers and container platforms.
 */
export function buildHttpApp(ctx: ToolContext): Express {
  const { config, logger } = ctx;
  const app = createMcpExpressApp({ host: config.MCP_HTTP_HOST });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info(
        { method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - start },
        "http request"
      );
    });
    next();
  });

  if (config.MCP_CORS_ORIGIN) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader("Access-Control-Allow-Origin", config.MCP_CORS_ORIGIN);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", service: "medium-mcp-server" });
  });

  app.use("/mcp", bearerAuthMiddleware(config, logger));

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"];
    try {
      let transport: StreamableHTTPServerTransport;

      if (typeof sessionId === "string" && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            logger.info({ sessionId: id }, "MCP session initialized");
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          const id = transport.sessionId;
          if (id && transports.has(id)) {
            logger.info({ sessionId: id }, "MCP session closed");
            transports.delete(id);
          }
        };

        const server = createMcpServer(ctx);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "error handling MCP POST request");
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId !== "string" || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing Mcp-Session-Id header");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  };

  app.get("/mcp", handleSessionRequest);
  app.delete("/mcp", handleSessionRequest);

  return app;
}

function bearerAuthMiddleware(config: AppConfig, logger: ToolContext["logger"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.MCP_SERVER_AUTH_TOKEN) {
      // Only reachable when MCP_ALLOW_UNAUTHENTICATED was explicitly set (config.ts
      // refuses to start in production otherwise).
      next();
      return;
    }

    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token || !safeEqual(token, config.MCP_SERVER_AUTH_TOKEN)) {
      logger.warn({ path: req.path }, "rejected unauthenticated MCP request");
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing or invalid bearer token" },
        id: null,
      });
      return;
    }

    next();
  };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
