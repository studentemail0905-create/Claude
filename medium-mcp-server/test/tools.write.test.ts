import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServerHandle } from "./testHarness.js";
import { callToolJson } from "./toolCallHelpers.js";

describe("create_draft", () => {
  let handle: TestServerHandle;

  afterEach(async () => {
    await handle?.close();
  });

  it("creates a draft (publishStatus=draft) under the authenticated user by default", async () => {
    handle = await startTestServer();
    const post = await callToolJson(handle.client, "create_draft", {
      title: "My Draft",
      content: "Draft body",
      contentFormat: "markdown",
    });

    expect(post.publishStatus).toBe("draft");
    expect(handle.mediumClient.createPostCalls).toHaveLength(1);
    expect(handle.mediumClient.createPostCalls[0]).toMatchObject({
      title: "My Draft",
      publishStatus: "draft",
      authorId: "user-123",
    });
  });

  it("creates a draft under a publication when publicationId is given", async () => {
    handle = await startTestServer();
    await callToolJson(handle.client, "create_draft", {
      title: "Pub Draft",
      content: "Body",
      contentFormat: "markdown",
      publicationId: "pub-1",
    });

    expect(handle.mediumClient.createPostCalls[0]).toMatchObject({ publicationId: "pub-1" });
    expect(handle.mediumClient.createPostCalls[0]!.authorId).toBeUndefined();
  });

  it("is omitted entirely when MEDIUM_ENABLE_WRITE_TOOLS=false", async () => {
    handle = await startTestServer({ MEDIUM_ENABLE_WRITE_TOOLS: "false" });
    const { tools } = await handle.client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("create_draft");
  });
});
