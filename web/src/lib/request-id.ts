export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * A fresh `x-request-id` for one request: `erp-web-` and 16 hex digits, inside the
 * `^[\w-]{8,64}$` the API accepts (docs/TELEMETRY.md), so the API keeps it rather than
 * replacing it, and every log line of the request carries it.
 */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `erp-web-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
