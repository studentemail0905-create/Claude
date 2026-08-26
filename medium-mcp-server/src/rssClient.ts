import Parser from "rss-parser";
import { fetchWithRetry } from "./lib/fetchWithRetry.js";
import { MediumApiError, MediumNetworkError, ValidationError } from "./errors.js";
import type { Logger } from "./logger.js";

export interface ArticleSummary {
  title: string;
  link: string;
  guid: string;
  publishedAt: string | undefined;
  author: string | undefined;
  categories: string[];
  contentSnippet: string | undefined;
}

export interface ArticleDetail extends ArticleSummary {
  /** Full HTML content of the article, as included in Medium's RSS feed. */
  contentHtml: string | undefined;
}

type FeedItem = Parser.Item & { "content:encoded"?: string; "content:encodedSnippet"?: string };

export interface RssClientOptions {
  baseUrl: string;
  timeoutMs: number;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

/**
 * Reads articles from Medium's public RSS feeds.
 *
 * Medium's official REST API does not expose any endpoint to list or fetch a
 * user's or publication's existing posts (see mediumClient.ts docstring), so
 * "article retrieval" is implemented against Medium's public RSS feeds
 * instead: https://medium.com/feed/@<username> for a user, and
 * https://medium.com/feed/<publication-slug> for a publication. Medium
 * includes the full post HTML in the RSS `content:encoded` field, so this
 * also covers fetching a single article's content. Only public posts are
 * exposed this way -- drafts and unlisted posts never appear in RSS.
 */
export class RssClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;
  private readonly fetchImpl?: typeof fetch;
  private readonly parser: Parser<unknown, FeedItem>;

  constructor(opts: RssClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs;
    this.logger = opts.logger;
    this.fetchImpl = opts.fetchImpl;
    this.parser = new Parser({ customFields: { item: [["content:encoded", "content:encoded"]] } });
  }

  feedUrlForUser(username: string): string {
    const handle = username.startsWith("@") ? username : `@${username}`;
    return `${this.baseUrl}/feed/${encodeURIComponent(handle)}`;
  }

  feedUrlForPublication(publicationSlug: string): string {
    const slug = publicationSlug.startsWith("/") ? publicationSlug.slice(1) : publicationSlug;
    return `${this.baseUrl}/feed/${slug}`;
  }

  async listArticles(feedUrl: string, limit = 10): Promise<ArticleSummary[]> {
    const items = await this.fetchFeedItems(feedUrl);
    return items.slice(0, limit).map(toSummary);
  }

  async getArticle(feedUrl: string, articleUrl: string): Promise<ArticleDetail> {
    const items = await this.fetchFeedItems(feedUrl);
    const normalizedTarget = normalizeUrl(articleUrl);
    const match = items.find((item) => item.link && normalizeUrl(item.link) === normalizedTarget);

    if (!match) {
      throw new ValidationError(
        `No article matching URL "${articleUrl}" was found in the feed. Only public posts already ` +
          `syndicated to RSS are retrievable; drafts and unlisted posts are not."`
      );
    }

    return {
      ...toSummary(match),
      contentHtml: match["content:encoded"] ?? match.content,
    };
  }

  private async fetchFeedItems(feedUrl: string): Promise<FeedItem[]> {
    let res: Response;
    try {
      res = await fetchWithRetry(
        feedUrl,
        { method: "GET", headers: { Accept: "application/rss+xml, application/xml, text/xml" } },
        { timeoutMs: this.timeoutMs, logger: this.logger, fetchImpl: this.fetchImpl }
      );
    } catch (err) {
      if (err instanceof MediumNetworkError) throw err;
      throw new MediumNetworkError(`Failed to fetch Medium RSS feed at ${feedUrl}: ${String(err)}`, err);
    }

    if (res.status === 404) {
      throw new ValidationError(`No Medium feed found at ${feedUrl}. Check the username or publication slug.`);
    }
    if (!res.ok) {
      throw new MediumApiError(`Failed to fetch Medium RSS feed (status ${res.status}).`, res.status);
    }

    const xml = await res.text();
    try {
      const feed = await this.parser.parseString(xml);
      return feed.items ?? [];
    } catch (err) {
      throw new MediumApiError(`Failed to parse Medium RSS feed at ${feedUrl}: ${String(err)}`, res.status);
    }
  }
}

function toSummary(item: FeedItem): ArticleSummary {
  return {
    title: item.title ?? "(untitled)",
    link: item.link ?? "",
    guid: item.guid ?? item.link ?? "",
    publishedAt: item.pubDate,
    author: item.creator,
    categories: item.categories ?? [],
    contentSnippet: item.contentSnippet ?? item["content:encodedSnippet"],
  };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}
