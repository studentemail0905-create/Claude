import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { jsonResult, withLogging } from "./toolHelpers.js";
import { articleInputShape, type ArticleInput } from "./schemas.js";
import { resolvePostInput } from "../lib/resolvePostInput.js";
import { PublishConfirmationError } from "../errors.js";

const PUBLISH_STATUS_CHOICES = ["public", "unlisted"] as const;
const ACKNOWLEDGEMENT_PHRASE = "PUBLISH" as const;

/**
 * Registers the two-step publish flow:
 *
 *   1. request_publish_confirmation -- takes the full article, resolves the
 *      real Medium target (user or publication), and returns a short-lived,
 *      single-use confirmationToken plus a human-readable summary. Nothing
 *      is sent to Medium yet.
 *   2. publish_article -- takes only the confirmationToken and a literal
 *      acknowledgement string ("PUBLISH"). Only this call actually creates
 *      the public post on Medium.
 *
 * This means publishing can never happen from a single tool call: an agent
 * (or the human supervising it) always sees the exact content and target
 * that is about to go live before the irreversible step runs. Medium's API
 * has no "unpublish" endpoint, so treat step 2 as final.
 */
export function registerPublishTools(server: McpServer, ctx: ToolContext): void {
  const { mediumClient, confirmationStore, logger, config } = ctx;

  server.registerTool(
    "request_publish_confirmation",
    {
      title: "Preview and confirm before publishing to Medium",
      description:
        "Step 1 of 2 for publishing. Validates and resolves the article and target (user profile or " +
        "publication), then returns a confirmationToken (valid for a limited time, single use) and a " +
        "human-readable summary of exactly what will be published and where. This call makes NO change " +
        "to Medium. You must show the summary to the user (or otherwise obtain explicit approval) and " +
        "then call publish_article with the returned confirmationToken to actually publish.",
      inputSchema: {
        ...articleInputShape,
        publishStatus: z
          .enum(PUBLISH_STATUS_CHOICES)
          .default("public")
          .describe('"public" (default, publicly visible and indexed) or "unlisted" (accessible only via direct link).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, title: "Preview and confirm before publishing to Medium" },
    },
    withLogging(
      logger,
      "request_publish_confirmation",
      async ({ publishStatus, ...articleInput }: ArticleInput & { publishStatus: (typeof PUBLISH_STATUS_CHOICES)[number] }) => {
        const postInput = await resolvePostInput(mediumClient, articleInput, publishStatus);
        const pending = confirmationStore.create(postInput);
        const wordCount = articleInput.content.trim().split(/\s+/).filter(Boolean).length;

        return jsonResult({
          confirmationToken: pending.token,
          expiresAt: new Date(pending.expiresAt).toISOString(),
          summary: {
            title: articleInput.title,
            publishStatus,
            wordCount,
            tags: articleInput.tags ?? [],
            target: postInput.publicationId ? { type: "publication", publicationId: postInput.publicationId } : { type: "user", authorId: postInput.authorId },
          },
          nextStep:
            `To publish, call publish_article with confirmationToken="${pending.token}" and ` +
            `acknowledgement="${ACKNOWLEDGEMENT_PHRASE}" before ${new Date(pending.expiresAt).toISOString()}. ` +
            "This action cannot be undone through this server once confirmed.",
        });
      }
    )
  );

  server.registerTool(
    "publish_article",
    {
      title: "Publish a previously confirmed article to Medium",
      description:
        "Step 2 of 2 for publishing. Publishes an article that was already previewed via " +
        "request_publish_confirmation. Requires the confirmationToken returned by that call and the " +
        "literal acknowledgement string \"PUBLISH\". The token is single-use and expires shortly after " +
        "it was issued. This is the only tool in this server that makes content publicly visible on " +
        "Medium, and it cannot be undone through this server.",
      inputSchema: {
        confirmationToken: z.string().min(1).describe("The confirmationToken returned by request_publish_confirmation."),
        acknowledgement: z
          .literal(ACKNOWLEDGEMENT_PHRASE)
          .describe('Must be exactly "PUBLISH", confirming the caller has reviewed and approved the summary.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        title: "Publish a previously confirmed article to Medium",
      },
    },
    withLogging(logger, "publish_article", async ({ confirmationToken }: { confirmationToken: string; acknowledgement: typeof ACKNOWLEDGEMENT_PHRASE }) => {
      if (!config.MEDIUM_ENABLE_PUBLISH_TOOL) {
        throw new PublishConfirmationError("Publishing is disabled on this server (MEDIUM_ENABLE_PUBLISH_TOOL=false).");
      }
      let pending;
      try {
        pending = confirmationStore.redeem(confirmationToken);
      } catch (err) {
        throw new PublishConfirmationError(err instanceof Error ? err.message : String(err));
      }

      const post = await mediumClient.createPost(pending.payload);
      return jsonResult({ published: true, ...post });
    })
  );
}
