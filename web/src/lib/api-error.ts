// Adapted from Cwork (web/src/lib/api-error.ts), see NOTICE. The ERP's error body is
// `{ statusCode, code, message, details, path, requestId, timestamp }`.

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  requestId?: unknown;
}

/** Status 0: the request never got an answer from the API. */
export const UNREACHABLE = 0;

/**
 * A request that did not produce a usable answer. Carries the server's stable `code`,
 * so callers branch on the reason rather than on a message, and the correlation id the
 * API returned, so the person seeing the error can quote it (ADR-0011).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** The body's `requestId` wins; the `x-request-id` header covers bodies that are not JSON. */
  static fromBody(status: number, body: ErrorBody | null, headerRequestId?: string): ApiError {
    return new ApiError(
      status,
      typeof body?.code === 'string' ? body.code : `HTTP_${status}`,
      typeof body?.message === 'string' ? body.message : '',
      body?.details,
      typeof body?.requestId === 'string' ? body.requestId : headerRequestId,
    );
  }

  static unreachable(cause: unknown): ApiError {
    return new ApiError(UNREACHABLE, 'UNREACHABLE', String(cause));
  }

  get isUnreachable(): boolean {
    return this.status === UNREACHABLE;
  }

  /** Retrying the same request will not help for these. */
  get isTerminal(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}
