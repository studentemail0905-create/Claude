/** Base class for all errors this server raises intentionally (as opposed to bugs). */
export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, opts: { code: string; retryable?: boolean; cause?: unknown }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
  }
}

/** The Medium API rejected the request outright (bad input, not our problem to retry). */
export class MediumApiError extends AppError {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, status: number, body?: unknown, retryable = false) {
    super(message, { code: "MEDIUM_API_ERROR", retryable, cause: body });
    this.status = status;
    this.body = body;
  }
}

/** The Medium integration token is missing, malformed, or rejected (401/403). */
export class MediumAuthError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "MEDIUM_AUTH_ERROR", retryable: false, cause });
  }
}

/** Medium rate-limited us (429). Caller may retry after a delay. */
export class MediumRateLimitError extends AppError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message, { code: "MEDIUM_RATE_LIMITED", retryable: true });
    this.retryAfterMs = retryAfterMs;
  }
}

/** Network-level failure (timeout, DNS, connection reset) talking to Medium. */
export class MediumNetworkError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "MEDIUM_NETWORK_ERROR", retryable: true, cause });
  }
}

/** Input failed validation before any network call was made. */
export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "VALIDATION_ERROR", retryable: false, cause });
  }
}

/** A publish confirmation token was missing, expired, already used, or didn't match. */
export class PublishConfirmationError extends AppError {
  constructor(message: string) {
    super(message, { code: "PUBLISH_CONFIRMATION_ERROR", retryable: false });
  }
}

/** A requested tool is disabled by server configuration (read/write/publish toggles). */
export class ToolDisabledError extends AppError {
  constructor(message: string) {
    super(message, { code: "TOOL_DISABLED", retryable: false });
  }
}

export function toUserFacingMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) return "An unexpected error occurred.";
  return "An unexpected error occurred.";
}
