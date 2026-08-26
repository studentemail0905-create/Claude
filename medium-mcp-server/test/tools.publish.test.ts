import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServerHandle } from "./testHarness.js";
import { callToolJson, callToolExpectError } from "./toolCallHelpers.js";

describe("publish confirmation flow", () => {
  let handle: TestServerHandle;

  afterEach(async () => {
    await handle?.close();
  });

  it("publish_article cannot be called without ever requesting confirmation", async () => {
    handle = await startTestServer();
    const errorText = await callToolExpectError(handle.client, "publish_article", {
      confirmationToken: "totally-made-up-token",
      acknowledgement: "PUBLISH",
    });
    expect(errorText).toMatch(/Unknown or already-used/);
    expect(handle.mediumClient.createPostCalls).toHaveLength(0);
  });

  it("the acknowledgement field rejects anything other than the literal string PUBLISH", async () => {
    handle = await startTestServer();
    const confirmation = await callToolJson(handle.client, "request_publish_confirmation", {
      title: "My Article",
      content: "Body text",
      contentFormat: "markdown",
    });

    const result = await handle.client.callTool({
      name: "publish_article",
      arguments: { confirmationToken: confirmation.confirmationToken, acknowledgement: "yes please" },
    });
    expect(result.isError).toBe(true);
    expect(handle.mediumClient.createPostCalls).toHaveLength(0);
  });

  it("request_publish_confirmation never calls the Medium API", async () => {
    handle = await startTestServer();
    await callToolJson(handle.client, "request_publish_confirmation", {
      title: "Preview Only",
      content: "Body",
      contentFormat: "markdown",
    });
    expect(handle.mediumClient.createPostCalls).toHaveLength(0);
  });

  it("the full two-step flow publishes exactly once with matching content", async () => {
    handle = await startTestServer();

    const confirmation = await callToolJson(handle.client, "request_publish_confirmation", {
      title: "Ready To Ship",
      content: "Final body copy.",
      contentFormat: "markdown",
      tags: ["testing", "mcp"],
      publishStatus: "public",
    });

    expect(confirmation.summary.title).toBe("Ready To Ship");
    expect(confirmation.summary.publishStatus).toBe("public");
    expect(confirmation.summary.target).toEqual({ type: "user", authorId: "user-123" });

    const result = await callToolJson(handle.client, "publish_article", {
      confirmationToken: confirmation.confirmationToken,
      acknowledgement: "PUBLISH",
    });

    expect(result.published).toBe(true);
    expect(handle.mediumClient.createPostCalls).toHaveLength(1);
    expect(handle.mediumClient.createPostCalls[0]).toMatchObject({
      title: "Ready To Ship",
      publishStatus: "public",
      tags: ["testing", "mcp"],
    });
  });

  it("a confirmation token can only be redeemed once", async () => {
    handle = await startTestServer();
    const confirmation = await callToolJson(handle.client, "request_publish_confirmation", {
      title: "Once Only",
      content: "Body",
      contentFormat: "markdown",
    });

    await callToolJson(handle.client, "publish_article", {
      confirmationToken: confirmation.confirmationToken,
      acknowledgement: "PUBLISH",
    });

    const errorText = await callToolExpectError(handle.client, "publish_article", {
      confirmationToken: confirmation.confirmationToken,
      acknowledgement: "PUBLISH",
    });
    expect(errorText).toMatch(/Unknown or already-used/);
    expect(handle.mediumClient.createPostCalls).toHaveLength(1);
  });

  it("publishing to a publication resolves the target instead of the user", async () => {
    handle = await startTestServer();
    const confirmation = await callToolJson(handle.client, "request_publish_confirmation", {
      title: "Pub Post",
      content: "Body",
      contentFormat: "markdown",
      publicationId: "pub-1",
    });
    expect(confirmation.summary.target).toEqual({ type: "publication", publicationId: "pub-1" });

    await callToolJson(handle.client, "publish_article", {
      confirmationToken: confirmation.confirmationToken,
      acknowledgement: "PUBLISH",
    });
    expect(handle.mediumClient.createPostCalls[0]).toMatchObject({ publicationId: "pub-1" });
  });

  it("publish_article is unavailable when MEDIUM_ENABLE_PUBLISH_TOOL=false", async () => {
    handle = await startTestServer({ MEDIUM_ENABLE_PUBLISH_TOOL: "false" });
    const { tools } = await handle.client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("publish_article");
    expect(tools.map((t) => t.name)).not.toContain("request_publish_confirmation");
  });
});
