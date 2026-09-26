// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The in-browser demo API (#41, ADR-0021): answers the console's requests from the demo seed
 * held in memory, so the public demo on GitHub Pages runs with no server. Built only into the
 * demo build (`VITE_ERP_DEMO=1`); a normal build carries none of it. Every route the console
 * calls today is here, with the API's authentication, permissions and error body
 * `{ statusCode, code, message, details, path, requestId, timestamp }`. A route it does not
 * serve — a screen added after the demo — answers `NOT_IN_DEMO`, which the console explains,
 * instead of failing some other way.
 */
import { Permission, type PermissionKey } from '@backend/src/core/security/permissions';
import * as auth from './auth';
import { DemoError, type Context } from './http';
import * as masterData from './master-data';
import { seedState, type DemoState } from './state';
import * as stock from './stock';

/** Found in the demo build's bundle and nowhere in a normal one (scripts/check-demo-build.mjs). */
export const DEMO_BUILD_MARKER = 'payneat-erp-in-browser-demo-api';

type Handler = (state: DemoState, ctx: Context) => unknown;

interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pattern: RegExp;
  handler: Handler;
  /** Open to anyone; every other route needs a session. */
  open?: boolean;
  permission?: PermissionKey;
  /** 200 unless the API answers otherwise (201 for a created resource, 204 for nothing). */
  status?: number;
}

const V1 = '/api/v1';

function route(
  method: Route['method'],
  path: string,
  handler: Handler,
  options: Omit<Route, 'method' | 'pattern' | 'handler'> = {},
): Route {
  const pattern = new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`);
  return { method, pattern, handler, ...options };
}

const ROUTES: readonly Route[] = [
  route('GET', '/health', () => ({ status: 'ok', api: 'up', database: 'up' }), { open: true }),
  route('GET', `${V1}/installation`, () => ({ demo: true }), { open: true }),

  route('POST', `${V1}/auth/login`, auth.login, { open: true }),
  route('POST', `${V1}/auth/mfa/verify`, auth.verifyMfa, { open: true }),
  route('POST', `${V1}/auth/mfa/enroll`, auth.beginEnrolment, { open: true }),
  route('POST', `${V1}/auth/mfa/activate`, auth.activateMfa, { open: true }),
  route('POST', `${V1}/auth/refresh`, auth.refresh, { open: true }),
  route('POST', `${V1}/auth/logout`, auth.logout, { status: 204 }),
  route('GET', `${V1}/auth/me`, auth.me),
  route('GET', `${V1}/auth/mfa/status`, auth.mfaStatus),

  route('GET', `${V1}/roles`, auth.roles, { permission: Permission.USER_READ }),
  route('GET', `${V1}/users`, auth.listUsers, { permission: Permission.USER_READ }),
  route('GET', `${V1}/users/:id`, auth.getUser, { permission: Permission.USER_READ }),
  route('POST', `${V1}/users`, auth.createUser, {
    permission: Permission.USER_MANAGE,
    status: 201,
  }),
  route('PUT', `${V1}/users/:id/roles/:role`, auth.grantRole, {
    permission: Permission.USER_MANAGE,
  }),
  route('DELETE', `${V1}/users/:id/roles/:role`, auth.revokeRole, {
    permission: Permission.USER_MANAGE,
  }),

  route('GET', `${V1}/units`, masterData.units),
  route('GET', `${V1}/items`, masterData.listItems),
  route('GET', `${V1}/items/:id`, masterData.getItem),
  route('POST', `${V1}/items`, masterData.createItem, {
    permission: Permission.ITEM_MANAGE,
    status: 201,
  }),
  route('PATCH', `${V1}/items/:id`, masterData.updateItem, { permission: Permission.ITEM_MANAGE }),

  route('GET', `${V1}/locations`, masterData.listLocations),
  route('GET', `${V1}/locations/:id`, masterData.getLocation),
  route('POST', `${V1}/locations`, masterData.createLocation, {
    permission: Permission.LOCATION_MANAGE,
    status: 201,
  }),
  route('PATCH', `${V1}/locations/:id`, masterData.updateLocation, {
    permission: Permission.LOCATION_MANAGE,
  }),
  route('POST', `${V1}/locations/:id/supersede`, masterData.supersedeLocation, {
    permission: Permission.LOCATION_MANAGE,
  }),

  route('GET', `${V1}/suppliers`, masterData.listSuppliers),
  route('GET', `${V1}/suppliers/:id`, masterData.getSupplier),
  route('POST', `${V1}/suppliers`, masterData.createSupplier, {
    permission: Permission.SUPPLIER_MANAGE,
    status: 201,
  }),
  route('PATCH', `${V1}/suppliers/:id`, masterData.updateSupplier, {
    permission: Permission.SUPPLIER_MANAGE,
  }),

  route('GET', `${V1}/stock-on-hand`, stock.stockOnHand),
  route('GET', `${V1}/opening-balances`, stock.listOpeningBalances),
  route('GET', `${V1}/opening-balances/:id`, stock.getOpeningBalance),
  route('POST', `${V1}/opening-balances`, stock.createOpeningBalance, {
    permission: Permission.OPENING_BALANCE_MANAGE,
    status: 201,
  }),
  route('PATCH', `${V1}/opening-balances/:id`, stock.updateOpeningBalance, {
    permission: Permission.OPENING_BALANCE_MANAGE,
  }),
  route('POST', `${V1}/opening-balances/:id/post`, stock.postOpeningBalance, {
    permission: Permission.OPENING_BALANCE_MANAGE,
  }),
  route('POST', `${V1}/opening-balances/:id/reverse`, stock.reverseOpeningBalance, {
    permission: Permission.OPENING_BALANCE_MANAGE,
  }),
];

export interface DemoRequest {
  method: string;
  /** The path and query, as the console sent them: `/api/v1/items?status=all`. */
  url: string;
  headers: Headers;
  /** The parsed JSON body, if any. */
  body?: unknown;
}

export interface DemoResponse {
  status: number;
  /** Undefined for 204. */
  body?: unknown;
  requestId: string;
}

const REQUEST_ID = /^[\w-]{8,64}$/;

function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `demo-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class DemoServer {
  private state: DemoState;
  private readonly clock: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.clock = options.now ?? Date.now;
    this.state = seedState(new Date(this.clock()));
  }

  /** The paths the API serves: the demo answers these and nothing else. */
  static handles(pathname: string): boolean {
    return pathname === '/health' || pathname === V1 || pathname.startsWith(`${V1}/`);
  }

  /** Back to the demo seed, as a reload does. */
  reset(): void {
    this.state = seedState(new Date(this.clock()));
  }

  async handle(request: DemoRequest): Promise<DemoResponse> {
    const url = new URL(request.url, 'https://demo.invalid');
    const incoming = request.headers.get('x-request-id');
    const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : newRequestId();
    const method = request.method.toUpperCase();
    try {
      const found = this.match(method, url.pathname);
      if (!found) {
        throw new DemoError(
          404,
          'NOT_IN_DEMO',
          `${method} ${url.pathname} is not in the demo; it needs a real installation`,
        );
      }
      const { route: target, params } = found;
      const ctx: Context = {
        params,
        query: url.searchParams,
        body: request.body,
        headers: request.headers,
        actor: null,
        now: this.clock(),
      };
      if (!target.open) {
        ctx.actor = auth.sessionUser(this.state, request.headers, ctx.now);
        if (
          target.permission &&
          !auth.permissionsFor(ctx.actor.roles).includes(target.permission)
        ) {
          throw new DemoError(403, 'ACCESS_DENIED', `Missing permission: ${target.permission}`);
        }
      }
      const result = await target.handler(this.state, ctx);
      const status = target.status ?? 200;
      // A copy, so nothing the console holds can reach into the demo's state.
      const body = status === 204 ? undefined : JSON.parse(JSON.stringify(result ?? null));
      return { status, body, requestId };
    } catch (error) {
      if (!(error instanceof DemoError)) throw error;
      return {
        status: error.status,
        body: {
          statusCode: error.status,
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          path: url.pathname,
          requestId,
          timestamp: new Date(this.clock()).toISOString(),
        },
        requestId,
      };
    }
  }

  private match(method: string, pathname: string) {
    for (const candidate of ROUTES) {
      if (candidate.method !== method) continue;
      const match = candidate.pattern.exec(pathname);
      if (match) return { route: candidate, params: match.slice(1).map(decodeURIComponent) };
    }
    return null;
  }
}
