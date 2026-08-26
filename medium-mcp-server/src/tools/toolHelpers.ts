import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "../logger.js";
import { AppError } from "../errors.js";

/** Wraps a JS value as the single text-content block of an MCP tool result. */
export function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Wraps a tool handler with structured start/success/failure logging. Only
 * the tool name, duration, and (on failure) the error code/message are
 * logged -- never raw tool arguments, since those may contain article
 * content or, transitively, secrets.
 */
export function withLogging<TArgs, TResult>(
  logger: Logger,
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs) => {
    const start = Date.now();
    const log = logger.child({ tool: toolName });
    log.info("tool invocation started");
    try {
      const result = await handler(args);
      log.info({ durationMs: Date.now() - start }, "tool invocation succeeded");
      return result;
    } catch (err) {
      log.error(
        {
          durationMs: Date.now() - start,
          errorCode: err instanceof AppError ? err.code : "UNKNOWN",
          error: err instanceof Error ? err.message : String(err),
        },
        "tool invocation failed"
      );
      throw err;
    }
  };
}
