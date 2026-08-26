import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, FAKE_ME, FAKE_PUBLICATIONS, type TestServerHandle } from "./testHarness.js";
import { callToolJson, callToolExpectError } from "./toolCallHelpers.js";

describe("read tools", () => {
  let handle: TestServerHandle;

  afterEach(async () => {
    await handle?.close();
  });

  it("exposes exactly the expected tool set with readOnlyHint on read tools", async () => {
    handle = await startTestServer();
    const { tools } = await handle.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["create_draft", "get_article", "get_profile", "list_articles", "list_publications", "publish_article", "request_publish_confirmation"].sort()
    );

    const getProfile = tools.find((t) => t.name === "get_profile")!;
    expect(getProfile.annotations?.readOnlyHint).toBe(true);
  });

  it("get_profile returns the authenticated user", async () => {
    handle = await startTestServer();
    const me = await callToolJson(handle.client, "get_profile");
    expect(me).toEqual(FAKE_ME);
  });

  it("list_publications defaults to the authenticated user's id", async () => {
    handle = await startTestServer();
    const result = await callToolJson(handle.client, "list_publications");
    expect(result.userId).toBe(FAKE_ME.id);
    expect(result.publications).toEqual(FAKE_PUBLICATIONS);
  });

  it("list_articles requires a username or publicationSlug", async () => {
    handle = await startTestServer();
    const errorText = await callToolExpectError(handle.client, "list_articles", {});
    expect(errorText).toMatch(/username or publicationSlug/);
  });

  it("list_articles returns articles for a given username", async () => {
    handle = await startTestServer();
    const result = await callToolJson(handle.client, "list_articles", { username: "testuser", limit: 5 });
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].title).toBe("An Existing Article");
  });

  it("get_article fetches full content for a known article URL", async () => {
    handle = await startTestServer();
    const article = await callToolJson(handle.client, "get_article", {
      username: "testuser",
      articleUrl: "https://medium.com/@testuser/an-existing-article-abc123",
    });
    expect(article.contentHtml).toContain("Full article content");
  });

  it("get_article errors on an unknown article URL", async () => {
    handle = await startTestServer();
    const errorText = await callToolExpectError(handle.client, "get_article", {
      username: "testuser",
      articleUrl: "https://medium.com/@testuser/does-not-exist",
    });
    expect(errorText).toMatch(/No article matching URL/);
  });

  it("omits read tools entirely when MEDIUM_ENABLE_READ_TOOLS=false", async () => {
    handle = await startTestServer({ MEDIUM_ENABLE_READ_TOOLS: "false" });
    const { tools } = await handle.client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("get_profile");
  });
});
