// Adapted from Cwork (web/src/lib/env.ts), see NOTICE.
export const env = {
  /**
   * Empty = same origin: nginx (Docker) and Vite (development) forward `/api` and `/health`
   * to the API, so the browser never needs CORS. Set `VITE_API_ORIGIN` only for a console
   * served from a different host than the API.
   */
  apiOrigin: import.meta.env.VITE_API_ORIGIN ?? '',
  /** The API's global prefix and default URI version (backend `http-setup.ts`). */
  apiPrefix: '/api/v1',
} as const;
