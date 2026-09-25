// Adapted from Cwork (web/src/lib/api-client.ts), see NOTICE. Cwork's token refresh is
// left out until sign-in exists (#4); the request/send/parse structure is Cwork's.
import { documentLanguage } from '@/i18n/catalogue';
import { ApiError } from './api-error';
import { env } from './env';
import { newRequestId, REQUEST_ID_HEADER } from './request-id';

type QueryValue = string | number | boolean | string[] | undefined | null;

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** For paths outside the `/api/v1` prefix, such as `/health`. */
  unversioned?: boolean;
  /** Non-2xx statuses whose body is an answer, not an error (`/health` answers 503). */
  acceptStatus?: readonly number[];
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  /** The correlation id the API returned in `x-request-id`. */
  requestId?: string;
}

/** Single HTTP entry point: every request gets a correlation id and the console's language. */
class ApiClient {
  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, options).then((r) => r.data);
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...options, body }).then((r) => r.data);
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body }).then((r) => r.data);
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body }).then((r) => r.data);
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, options).then((r) => r.data);
  }

  /** The full answer, status and correlation id included. */
  async request<T>(method: string, path: string, options: RequestOptions): Promise<ApiResponse<T>> {
    const base = options.unversioned ? env.apiOrigin : env.apiOrigin + env.apiPrefix;
    const url = base + path + buildQueryString(options.query);

    let response: Response;
    try {
      response = await this.send(method, url, options);
    } catch (cause) {
      throw ApiError.unreachable(cause);
    }

    const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;
    if (!response.ok && !options.acceptStatus?.includes(response.status)) {
      throw ApiError.fromBody(response.status, await safeJson(response), requestId);
    }
    return { data: await parseBody<T>(response), status: response.status, requestId };
  }

  private send(method: string, url: string, options: RequestOptions): Promise<Response> {
    // Options only this client understands are kept out of what goes to fetch().
    const { body: payload, query, unversioned, acceptStatus, ...init } = options;
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Accept-Language', documentLanguage());
    headers.set(REQUEST_ID_HEADER, newRequestId());

    let body: BodyInit | undefined;
    if (payload !== undefined) {
      if (payload instanceof FormData) {
        body = payload;
      } else {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(payload);
      }
    }

    return fetch(url, { ...init, method, headers, body });
  }
}

async function parseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function buildQueryString(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.clone().json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const api = new ApiClient();
