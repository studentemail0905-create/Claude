import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "../src/lib/fetchWithRetry.js";
import { MediumNetworkError, MediumRateLimitError } from "../src/errors.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("fetchWithRetry", () => {
  it("returns immediately on a successful response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const res = await fetchWithRetry("https://example.test", {}, { timeoutMs: 1000, fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 and eventually succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: "unavailable" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const res = await fetchWithRetry("https://example.test", {}, { timeoutMs: 1000, maxAttempts: 3, fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable 4xx responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: "bad request" }));
    const res = await fetchWithRetry("https://example.test", {}, { timeoutMs: 1000, maxAttempts: 3, fetchImpl });
    expect(res.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws MediumRateLimitError after exhausting retries on 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: "slow down" }, { "retry-after": "1" }));
    await expect(
      fetchWithRetry("https://example.test", {}, { timeoutMs: 1000, maxAttempts: 2, fetchImpl })
    ).rejects.toBeInstanceOf(MediumRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("wraps a persistent network failure in MediumNetworkError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      fetchWithRetry("https://example.test", {}, { timeoutMs: 1000, maxAttempts: 2, fetchImpl })
    ).rejects.toBeInstanceOf(MediumNetworkError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("wraps a timeout (abort) in MediumNetworkError with a clear message", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    await expect(
      fetchWithRetry("https://example.test", {}, { timeoutMs: 20, maxAttempts: 1, fetchImpl })
    ).rejects.toThrow(/timed out/);
  });
});
