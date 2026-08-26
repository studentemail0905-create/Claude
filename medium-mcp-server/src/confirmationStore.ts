import { randomUUID, createHash } from "node:crypto";
import type { CreatePostInput } from "./mediumClient.js";

export interface PendingPublish {
  token: string;
  payload: CreatePostInput;
  payloadHash: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Holds pending "publish" requests behind a short-lived, single-use token so
 * that the `publish_article` tool can never fire on its own -- it must first
 * be preceded by a `request_publish_confirmation` call whose returned token
 * (and a re-supplied, hash-matched payload) is presented back.
 *
 * This is an in-memory, single-process store. It is intentionally simple:
 * confirmation tokens are meant to be redeemed within minutes by the same
 * conversation/session, not persisted across deployments. If you run this
 * server with multiple replicas behind a load balancer, either use sticky
 * sessions so a given MCP session always reaches the same replica, or swap
 * this for a shared store (e.g. Redis) implementing the same interface --
 * see the README's "Scaling the confirmation store" section.
 */
export class ConfirmationStore {
  private readonly pending = new Map<string, PendingPublish>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  create(payload: CreatePostInput): PendingPublish {
    this.sweepExpired();
    const now = Date.now();
    const entry: PendingPublish = {
      token: randomUUID(),
      payload,
      payloadHash: hashPayload(payload),
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.pending.set(entry.token, entry);
    return entry;
  }

  /**
   * Redeems a token: validates it exists, hasn't expired, and (if a payload
   * is re-supplied for verification) that it matches what was confirmed.
   * The token is consumed on success or on a definitive mismatch/expiry, so
   * it can never be replayed.
   */
  redeem(token: string, verifyPayload?: CreatePostInput): PendingPublish {
    const entry = this.pending.get(token);
    if (!entry) {
      throw new Error("Unknown or already-used publish confirmation token. Call request_publish_confirmation again.");
    }
    this.pending.delete(token);

    if (Date.now() > entry.expiresAt) {
      throw new Error("Publish confirmation token has expired. Call request_publish_confirmation again.");
    }

    if (verifyPayload && hashPayload(verifyPayload) !== entry.payloadHash) {
      throw new Error(
        "The article content supplied to publish_article does not match what was confirmed by " +
          "request_publish_confirmation. Request a new confirmation for the updated content."
      );
    }

    return entry;
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [token, entry] of this.pending) {
      if (now > entry.expiresAt) this.pending.delete(token);
    }
  }

  /** Test/diagnostic helper. */
  size(): number {
    return this.pending.size;
  }
}

function hashPayload(payload: CreatePostInput): string {
  const normalized = JSON.stringify({
    title: payload.title,
    content: payload.content,
    contentFormat: payload.contentFormat,
    tags: [...(payload.tags ?? [])].sort(),
    canonicalUrl: payload.canonicalUrl ?? null,
    publishStatus: payload.publishStatus,
    license: payload.license ?? null,
    notifyFollowers: payload.notifyFollowers ?? null,
    publicationId: payload.publicationId ?? null,
    authorId: payload.authorId ?? null,
  });
  return createHash("sha256").update(normalized).digest("hex");
}
