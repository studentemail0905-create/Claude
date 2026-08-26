import { describe, expect, it, vi } from "vitest";
import { RssClient } from "../src/rssClient.js";
import { ValidationError } from "../src/errors.js";

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Test User - Medium</title>
  <item>
    <title>First Post</title>
    <link>https://medium.com/@testuser/first-post-abc123</link>
    <guid isPermaLink="false">https://medium.com/p/abc123</guid>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <dc:creator>testuser</dc:creator>
    <category>testing</category>
    <content:encoded><![CDATA[<p>Full <b>HTML</b> content of the first post.</p>]]></content:encoded>
  </item>
  <item>
    <title>Second Post</title>
    <link>https://medium.com/@testuser/second-post-def456</link>
    <guid isPermaLink="false">https://medium.com/p/def456</guid>
    <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    <dc:creator>testuser</dc:creator>
    <content:encoded><![CDATA[<p>Second post content.</p>]]></content:encoded>
  </item>
</channel>
</rss>`;

function xmlResponse(status: number, body = ""): Response {
  return new Response(body, { status, headers: { "content-type": "application/rss+xml" } });
}

function makeClient(fetchImpl: typeof fetch) {
  return new RssClient({ baseUrl: "https://medium.com", timeoutMs: 1000, fetchImpl });
}

describe("RssClient", () => {
  it("builds feed URLs for users and publications", () => {
    const client = makeClient(vi.fn());
    expect(client.feedUrlForUser("testuser")).toBe("https://medium.com/feed/%40testuser");
    expect(client.feedUrlForUser("@testuser")).toBe("https://medium.com/feed/%40testuser");
    expect(client.feedUrlForPublication("better-programming")).toBe("https://medium.com/feed/better-programming");
  });

  it("listArticles parses feed items and respects the limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse(200, SAMPLE_FEED));
    const client = makeClient(fetchImpl);

    const articles = await client.listArticles("https://medium.com/feed/@testuser", 1);
    expect(articles).toHaveLength(1);
    expect(articles[0]!.title).toBe("First Post");
    expect(articles[0]!.categories).toEqual(["testing"]);
  });

  it("getArticle returns full HTML content for a matching URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse(200, SAMPLE_FEED));
    const client = makeClient(fetchImpl);

    const article = await client.getArticle("https://medium.com/feed/@testuser", "https://medium.com/@testuser/second-post-def456");
    expect(article.title).toBe("Second Post");
    expect(article.contentHtml).toContain("Second post content");
  });

  it("getArticle throws ValidationError when the URL isn't in the feed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse(200, SAMPLE_FEED));
    const client = makeClient(fetchImpl);

    await expect(client.getArticle("https://medium.com/feed/@testuser", "https://medium.com/@testuser/nope")).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("throws ValidationError on a 404 feed (bad username/publication)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse(404));
    const client = makeClient(fetchImpl);

    await expect(client.listArticles("https://medium.com/feed/@ghost", 10)).rejects.toBeInstanceOf(ValidationError);
  });
});
