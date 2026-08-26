import { describe, expect, it, vi } from "vitest";
import { MediumClient } from "../src/mediumClient.js";
import { MediumApiError, MediumAuthError } from "../src/errors.js";

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeClient(fetchImpl: typeof fetch) {
  return new MediumClient({
    baseUrl: "https://api.medium.com/v1",
    integrationToken: "secret-token",
    timeoutMs: 1000,
    fetchImpl,
  });
}

describe("MediumClient", () => {
  it("getMe returns the unwrapped data envelope and sends a bearer token", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      expect(url).toBe("https://api.medium.com/v1/me");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
      return Promise.resolve(envelope(200, { data: { id: "u1", username: "me", name: "Me", url: "u", imageUrl: "i" } }));
    });

    const client = makeClient(fetchImpl);
    const me = await client.getMe();
    expect(me).toEqual({ id: "u1", username: "me", name: "Me", url: "u", imageUrl: "i" });
  });

  it("listPublications hits the correct user-scoped endpoint", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      expect(url).toBe("https://api.medium.com/v1/users/u1/publications");
      return Promise.resolve(envelope(200, { data: [{ id: "p1", name: "Pub", description: "", url: "", imageUrl: "" }] }));
    });

    const client = makeClient(fetchImpl);
    const pubs = await client.listPublications("u1");
    expect(pubs).toHaveLength(1);
    expect(pubs[0]!.id).toBe("p1");
  });

  it("createPost posts to the user endpoint when authorId is given", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      expect(url).toBe("https://api.medium.com/v1/users/u1/posts");
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ title: "Hello", publishStatus: "draft" });
      return Promise.resolve(
        envelope(201, { data: { id: "post1", title: "Hello", authorId: "u1", url: "https://medium.com/p/post1", publishStatus: "draft" } })
      );
    });

    const client = makeClient(fetchImpl);
    const post = await client.createPost({
      title: "Hello",
      content: "World",
      contentFormat: "markdown",
      publishStatus: "draft",
      authorId: "u1",
    });
    expect(post.id).toBe("post1");
  });

  it("createPost posts to the publication endpoint when publicationId is given", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      expect(url).toBe("https://api.medium.com/v1/publications/pub1/posts");
      return Promise.resolve(
        envelope(201, { data: { id: "post2", title: "Hi", authorId: "u1", url: "u", publishStatus: "public" } })
      );
    });

    const client = makeClient(fetchImpl);
    await client.createPost({
      title: "Hi",
      content: "There",
      contentFormat: "html",
      publishStatus: "public",
      publicationId: "pub1",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("createPost rejects when both or neither of authorId/publicationId are given", async () => {
    const client = makeClient(vi.fn());
    await expect(
      client.createPost({ title: "T", content: "C", contentFormat: "markdown", publishStatus: "draft" })
    ).rejects.toBeInstanceOf(MediumApiError);

    await expect(
      client.createPost({
        title: "T",
        content: "C",
        contentFormat: "markdown",
        publishStatus: "draft",
        authorId: "u1",
        publicationId: "p1",
      })
    ).rejects.toBeInstanceOf(MediumApiError);
  });

  it("maps a 401 response to MediumAuthError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope(401, { errors: [{ message: "invalid token" }] }));
    const client = makeClient(fetchImpl);
    await expect(client.getMe()).rejects.toBeInstanceOf(MediumAuthError);
  });

  it("maps a 400 response to MediumApiError with Medium's message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope(400, { errors: [{ message: "title is required" }] }));
    const client = makeClient(fetchImpl);
    await expect(client.getMe()).rejects.toThrow(/title is required/);
  });
});
