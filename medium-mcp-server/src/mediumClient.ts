import { fetchWithRetry } from "./lib/fetchWithRetry.js";
import { MediumApiError, MediumAuthError } from "./errors.js";
import type { Logger } from "./logger.js";

export interface MediumUser {
  id: string;
  username: string;
  name: string;
  url: string;
  imageUrl: string;
}

export interface MediumPublication {
  id: string;
  name: string;
  description: string;
  url: string;
  imageUrl: string;
}

export type ContentFormat = "html" | "markdown";
export type PublishStatus = "public" | "draft" | "unlisted";
export type License = "all-rights-reserved" | "cc-40-by" | "cc-40-by-sa" | "cc-40-by-nd" | "cc-40-by-nc" | "cc-40-by-nc-nd" | "cc-40-by-nc-sa" | "cc-40-zero" | "public-domain";

export interface CreatePostInput {
  title: string;
  content: string;
  contentFormat: ContentFormat;
  tags?: string[];
  canonicalUrl?: string;
  publishStatus: PublishStatus;
  license?: License;
  notifyFollowers?: boolean;
  /**
   * Exactly one of these targets must be set: `publicationId` posts under a
   * publication the authenticated user contributes to; `authorId` posts
   * directly to the authenticated user's profile (obtain it via getMe()).
   */
  publicationId?: string;
  authorId?: string;
}

export interface MediumPost {
  id: string;
  title: string;
  authorId: string;
  url: string;
  canonicalUrl?: string;
  publishStatus: PublishStatus;
  publishedAt?: number;
  tags?: string[];
  license?: string;
}

export interface MediumClientOptions {
  baseUrl: string;
  integrationToken: string;
  timeoutMs: number;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

interface MediumEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string; code?: number }>;
}

/**
 * Thin client over the Medium REST API (https://github.com/Medium/medium-api-docs).
 *
 * Important limitation, by design of Medium's API rather than this server:
 * there is no endpoint to list or fetch a user's/publication's existing posts,
 * and no endpoint to update a post after creation. Reading previously
 * published articles is done via RSS (see rssClient.ts); "drafting" and
 * "publishing" both go through the same create-post endpoint, distinguished
 * only by `publishStatus`.
 */
export class MediumClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: MediumClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.integrationToken;
    this.timeoutMs = opts.timeoutMs;
    this.logger = opts.logger;
    this.fetchImpl = opts.fetchImpl;
  }

  async getMe(): Promise<MediumUser> {
    const raw = await this.request<{
      id: string;
      username: string;
      name: string;
      url: string;
      imageUrl: string;
    }>("GET", "/me");
    return raw;
  }

  async listPublications(userId: string): Promise<MediumPublication[]> {
    const raw = await this.request<MediumPublication[]>("GET", `/users/${encodeURIComponent(userId)}/publications`);
    return raw;
  }

  async createPost(input: CreatePostInput): Promise<MediumPost> {
    if (Boolean(input.publicationId) === Boolean(input.authorId)) {
      throw new MediumApiError(
        "createPost requires exactly one of publicationId or authorId to be set.",
        400
      );
    }

    const path = input.publicationId
      ? `/publications/${encodeURIComponent(input.publicationId)}/posts`
      : `/users/${encodeURIComponent(input.authorId!)}/posts`;

    const body: Record<string, unknown> = {
      title: input.title,
      contentFormat: input.contentFormat,
      content: input.content,
      publishStatus: input.publishStatus,
    };
    if (input.tags?.length) body.tags = input.tags;
    if (input.canonicalUrl) body.canonicalUrl = input.canonicalUrl;
    if (input.license) body.license = input.license;
    if (typeof input.notifyFollowers === "boolean") body.notifyFollowers = input.notifyFollowers;

    const raw = await this.request<MediumPost>("POST", path, body);
    return raw;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetchWithRetry(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Charset": "utf-8",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      { timeoutMs: this.timeoutMs, logger: this.logger, fetchImpl: this.fetchImpl }
    );

    const text = await res.text();
    let parsed: MediumEnvelope<T> | undefined;
    try {
      parsed = text ? (JSON.parse(text) as MediumEnvelope<T>) : undefined;
    } catch {
      parsed = undefined;
    }

    if (res.status === 401 || res.status === 403) {
      const message = parsed?.errors?.[0]?.message ?? "Medium rejected the integration token (unauthorized).";
      throw new MediumAuthError(message);
    }

    if (!res.ok) {
      const message = parsed?.errors?.map((e) => e.message).join("; ") || `Medium API request failed with status ${res.status}.`;
      throw new MediumApiError(message, res.status, parsed?.errors);
    }

    if (!parsed?.data) {
      throw new MediumApiError("Medium API returned an unexpected empty response.", res.status);
    }

    return parsed.data;
  }
}
