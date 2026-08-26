import { MediumNetworkError, MediumRateLimitError } from "../errors.js";
import type { Logger } from "../logger.js";

export interface FetchWithRetryOptions {
  timeoutMs: number;
  maxAttempts?: number;
  logger?: Logger;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function parseRetryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/**
 * Fetch with a hard timeout and bounded exponential-backoff retries for
 * transient failures (network errors, 429, and 5xx). Non-retryable HTTP
 * responses (4xx other than 429) are returned as-is for the caller to
 * interpret into a domain error.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithRetryOptions
): Promise<Response> {
  const { timeoutMs, maxAttempts = 3, logger, fetchImpl = fetch } = opts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
        const retryAfterMs = parseRetryAfterMs(res) ?? backoffDelay(attempt);
        logger?.warn({ url, status: res.status, attempt, retryAfterMs }, "retrying transient Medium API failure");
        await sleep(retryAfterMs);
        continue;
      }

      if (res.status === 429 && attempt >= maxAttempts) {
        throw new MediumRateLimitError("Medium API rate limit exceeded after retries.", parseRetryAfterMs(res));
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      if (err instanceof MediumRateLimitError) throw err;

      const isAbort = err instanceof Error && err.name === "AbortError";
      if (attempt < maxAttempts) {
        const delay = backoffDelay(attempt);
        logger?.warn({ url, attempt, isAbort, err: String(err) }, "retrying after network/timeout error");
        await sleep(delay);
        continue;
      }

      throw new MediumNetworkError(
        isAbort ? `Request to Medium API timed out after ${timeoutMs}ms.` : `Network error contacting Medium API: ${String(err)}`,
        err
      );
    }
  }

  // Unreachable in practice, but keeps TypeScript happy.
  throw new MediumNetworkError("Exhausted retries contacting Medium API.", lastError);
}

function backoffDelay(attempt: number): number {
  const base = 300 * 2 ** (attempt - 1);
  const jitter = Math.random() * 100;
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
