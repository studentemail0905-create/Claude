import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { jsonResult, withLogging } from "./toolHelpers.js";
import { articleInputShape, type ArticleInput } from "./schemas.js";
import { resolvePostInput } from "../lib/resolvePostInput.js";

/**
 * Registers the drafting tool. Creating a draft is a write operation (it
 * creates real, if hidden, state on the Medium account) but it is never
 * publicly visible and never irreversible in the way publishing is, so it
 * does not go through the publish confirmation flow -- it only requires
 * MEDIUM_ENABLE_WRITE_TOOLS to be enabled.
 *
 * Note on Medium API limitations: Medium's API has no endpoint to update a
 * post after creation, including a draft created here. "Drafting" via this
 * tool creates a real Medium draft (visible in your Medium drafts list, and
 * editable there), but this server cannot later transform that same draft
 * into a published post through the API -- publish_article always creates a
 * new post. Treat create_draft as "save this content to Medium as a draft
 * for a human to review and publish from medium.com", not as step one of an
 * automated publish pipeline.
 */
export function registerWriteTools(server: McpServer, ctx: ToolContext): void {
  const { mediumClient, logger } = ctx;

  server.registerTool(
    "create_draft",
    {
      title: "Create a Medium draft",
      description:
        "Creates a new draft post on Medium (publishStatus=draft). The draft is private -- visible only " +
        "to the authenticated account in their Medium drafts list -- and is not announced or indexed. " +
        "This does NOT require publish confirmation, but does require write tools to be enabled on this " +
        "server. Medium's API cannot later edit or publish this exact draft by id; a human must finish it " +
        "on medium.com, or you can separately call request_publish_confirmation + publish_article with the " +
        "same content to publish it as a new post.",
      inputSchema: articleInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        title: "Create a Medium draft",
      },
    },
    withLogging(logger, "create_draft", async (input: ArticleInput) => {
      const postInput = await resolvePostInput(mediumClient, input, "draft");
      const post = await mediumClient.createPost(postInput);
      return jsonResult(post);
    })
  );
}
