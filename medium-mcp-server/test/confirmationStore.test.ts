import { describe, expect, it, vi } from "vitest";
import { ConfirmationStore } from "../src/confirmationStore.js";
import type { CreatePostInput } from "../src/mediumClient.js";

const PAYLOAD: CreatePostInput = {
  title: "T",
  content: "C",
  contentFormat: "markdown",
  publishStatus: "public",
  authorId: "u1",
};

describe("ConfirmationStore", () => {
  it("redeems a freshly created token exactly once", () => {
    const store = new ConfirmationStore(60_000);
    const pending = store.create(PAYLOAD);

    const redeemed = store.redeem(pending.token);
    expect(redeemed.payload).toEqual(PAYLOAD);

    expect(() => store.redeem(pending.token)).toThrow(/Unknown or already-used/);
  });

  it("rejects an unknown token", () => {
    const store = new ConfirmationStore(60_000);
    expect(() => store.redeem("not-a-real-token")).toThrow(/Unknown or already-used/);
  });

  it("rejects an expired token and removes it", () => {
    vi.useFakeTimers();
    try {
      const store = new ConfirmationStore(1000);
      const pending = store.create(PAYLOAD);
      vi.advanceTimersByTime(1001);
      expect(() => store.redeem(pending.token)).toThrow(/expired/);
      expect(store.size()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects redemption when the re-supplied payload does not match", () => {
    const store = new ConfirmationStore(60_000);
    const pending = store.create(PAYLOAD);

    expect(() => store.redeem(pending.token, { ...PAYLOAD, title: "Different title" })).toThrow(/does not match/);
  });

  it("accepts redemption when the re-supplied payload matches exactly", () => {
    const store = new ConfirmationStore(60_000);
    const pending = store.create(PAYLOAD);

    const redeemed = store.redeem(pending.token, { ...PAYLOAD });
    expect(redeemed.token).toBe(pending.token);
  });

  it("issues distinct tokens for separate confirmation requests", () => {
    const store = new ConfirmationStore(60_000);
    const a = store.create(PAYLOAD);
    const b = store.create(PAYLOAD);
    expect(a.token).not.toBe(b.token);
  });
});
