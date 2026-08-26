import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { jsonResult, withLogging } from "./toolHelpers.js";
import { ValidationError } from "../errors.js";

/**
 * Registers read-only tools: authenticated profile lookup, publication
 * listing, and article retrieval. None of these can modify the Medium
 * account in any way, so they carry the `readOnlyHint` annotation and are
 * safe to expose even to fully autonomous callers.
 */
export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  const { mediumClient, rssClient, logger } = ctx;

  server.registerTool(
    "get_profile",
    {
      title: "Get authenticated Medium profile",
      description:
        "Returns the Medium profile (id, username, display name, profile URL, avatar) for the account " +
        "that owns the configured integration token. Use this first to confirm which account you're " +
        "connected to, and to obtain the user id needed by other tools.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true, title: "Get authenticated Medium profile" },
    },
    withLogging(logger, "get_profile", async () => {
      const me = await mediumClient.getMe();
      return jsonResult(me);
    })
  );

  server.registerTool(
    "list_publications",
    {
      title: "List Medium publications",
      description:
        "Lists the Medium publications that the given user id (or the authenticated user, if userId is " +
        "omitted) contributes to or owns. Call get_profile first if you don't already have the user id.",
      inputSchema: {
        userId: z
          .string()
          .optional()
          .describe("Medium user id. Defaults to the authenticated user (from get_profile) if omitted."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, title: "List Medium publications" },
    },
    withLogging(logger, "list_publications", async ({ userId }: { userId?: string }) => {
      const resolvedUserId = userId ?? (await mediumClient.getMe()).id;
      const publications = await mediumClient.listPublications(resolvedUserId);
      return jsonResult({ userId: resolvedUserId, publications });
    })
  );

  server.registerTool(
    "list_articles",
    {
      title: "List published Medium articles",
      description:
        "Lists recently published, public articles for a Medium user or publication, via Medium's public " +
        "RSS feed. Medium's API does not expose an endpoint to list a user's or publication's posts " +
        "directly, so this reads the same public RSS feed Medium exposes at medium.com/feed/... Only " +
        "already-public posts appear here; drafts and unlisted posts never show up in RSS.",
      inputSchema: {
        username: z
          .string()
          .optional()
          .describe('Medium @handle to list articles for, e.g. "myhandle" or "@myhandle".'),
        publicationSlug: z
          .string()
          .optional()
          .describe('Publication slug to list articles for, e.g. "better-programming".'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .default(10)
          .describe("Maximum number of articles to return (most recent first). Defaults to 10, max 50."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, title: "List published Medium articles" },
    },
    withLogging(
      logger,
      "list_articles",
      async ({ username, publicationSlug, limit }: { username?: string; publicationSlug?: string; limit: number }) => {
        const feedUrl = resolveFeedUrl(ctx, { username, publicationSlug });
        const articles = await rssClient.listArticles(feedUrl, limit);
        return jsonResult({ feedUrl, count: articles.length, articles });
      }
    )
  );

  server.registerTool(
    "get_article",
    {
      title: "Get a Medium article's content",
      description:
        "Fetches the full content (as HTML) and metadata of one already-published, public Medium article " +
        "by its URL, via Medium's public RSS feed. Requires either username or publicationSlug so the " +
        "server knows which feed to search. Drafts and unlisted posts are not retrievable this way -- " +
        "Medium's API does not provide a way to fetch those by id.",
      inputSchema: {
        articleUrl: z.string().url().describe("The full URL of the published Medium article to fetch."),
        username: z.string().optional().describe("Medium @handle the article was published under."),
        publicationSlug: z.string().optional().describe("Publication slug the article was published under."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, title: "Get a Medium article's content" },
    },
    withLogging(
      logger,
      "get_article",
      async ({ articleUrl, username, publicationSlug }: { articleUrl: string; username?: string; publicationSlug?: string }) => {
        const feedUrl = resolveFeedUrl(ctx, { username, publicationSlug });
        const article = await rssClient.getArticle(feedUrl, articleUrl);
        return jsonResult(article);
      }
    )
  );
}

function resolveFeedUrl(
  ctx: ToolContext,
  opts: { username?: string; publicationSlug?: string }
): string {
  if (opts.username && opts.publicationSlug) {
    throw new ValidationError("Provide only one of username or publicationSlug, not both.");
  }
  if (opts.username) return ctx.rssClient.feedUrlForUser(opts.username);
  if (opts.publicationSlug) return ctx.rssClient.feedUrlForPublication(opts.publicationSlug);
  throw new ValidationError("Provide either username or publicationSlug to identify which feed to read.");
}
