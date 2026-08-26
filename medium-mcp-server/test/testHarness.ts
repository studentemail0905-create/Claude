import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLogger } from "../src/logger.js";
import { loadConfig } from "../src/config.js";
import { ConfirmationStore } from "../src/confirmationStore.js";
import { createMcpServer } from "../src/server.js";
import type { ToolContext } from "../src/tools/context.js";
import type { MediumClient, MediumUser, MediumPublication, MediumPost, CreatePostInput } from "../src/mediumClient.js";
import type { RssClient, ArticleSummary, ArticleDetail } from "../src/rssClient.js";

export const FAKE_ME: MediumUser = {
  id: "user-123",
  username: "testuser",
  name: "Test User",
  url: "https://medium.com/@testuser",
  imageUrl: "https://miro.medium.com/avatar.png",
};

export const FAKE_PUBLICATIONS: MediumPublication[] = [
  { id: "pub-1", name: "Test Pub", description: "A publication", url: "https://medium.com/test-pub", imageUrl: "" },
];

export interface FakeMediumClient extends MediumClient {
  createPostCalls: CreatePostInput[];
}

export function createFakeMediumClient(overrides?: Partial<MediumClient>): FakeMediumClient {
  const createPostCalls: CreatePostInput[] = [];
  const fake = {
    createPostCalls,
    getMe: async () => FAKE_ME,
    listPublications: async () => FAKE_PUBLICATIONS,
    createPost: async (input: CreatePostInput): Promise<MediumPost> => {
      createPostCalls.push(input);
      return {
        id: "post-1",
        title: input.title,
        authorId: input.authorId ?? FAKE_ME.id,
        url: "https://medium.com/@testuser/post-1",
        publishStatus: input.publishStatus,
        tags: input.tags,
      };
    },
    ...overrides,
  };
  return fake as unknown as FakeMediumClient;
}

const FAKE_ARTICLE: ArticleDetail = {
  title: "An Existing Article",
  link: "https://medium.com/@testuser/an-existing-article-abc123",
  guid: "https://medium.com/p/abc123",
  publishedAt: "Mon, 01 Jan 2024 00:00:00 GMT",
  author: "testuser",
  categories: ["testing"],
  contentSnippet: "This is a snippet...",
  contentHtml: "<p>Full article content.</p>",
};

export function createFakeRssClient(overrides?: Partial<RssClient>): RssClient {
  const fake = {
    feedUrlForUser: (username: string) => `https://medium.com/feed/@${username.replace(/^@/, "")}`,
    feedUrlForPublication: (slug: string) => `https://medium.com/feed/${slug}`,
    listArticles: async (_feedUrl: string, limit = 10): Promise<ArticleSummary[]> => {
      const { contentHtml: _contentHtml, ...summary } = FAKE_ARTICLE;
      return [summary].slice(0, limit);
    },
    getArticle: async (_feedUrl: string, articleUrl: string): Promise<ArticleDetail> => {
      if (articleUrl !== FAKE_ARTICLE.link) {
        throw new Error(`No article matching URL "${articleUrl}" was found in the feed.`);
      }
      return FAKE_ARTICLE;
    },
    ...overrides,
  };
  return fake as unknown as RssClient;
}

export interface TestServerHandle {
  client: Client;
  mediumClient: FakeMediumClient;
  ctx: ToolContext;
  close: () => Promise<void>;
}

/**
 * Spins up a real McpServer wired to fake Medium/RSS clients, connects a real
 * MCP Client to it over an in-memory transport pair, and returns both so
 * tests can exercise the full tools/list + tools/call path (including zod
 * input validation) exactly as a real MCP client would.
 */
export async function startTestServer(configOverrides: Record<string, string> = {}): Promise<TestServerHandle> {
  const config = loadConfig({
    MEDIUM_INTEGRATION_TOKEN: "test-token",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    ...configOverrides,
  } as NodeJS.ProcessEnv);

  const logger = createLogger(config);
  const mediumClient = createFakeMediumClient();
  const rssClient = createFakeRssClient();
  const confirmationStore = new ConfirmationStore(config.MEDIUM_PUBLISH_CONFIRMATION_TTL_MS);

  const ctx: ToolContext = { mediumClient, rssClient, confirmationStore, logger, config };
  const server = createMcpServer(ctx);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    mediumClient,
    ctx,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
