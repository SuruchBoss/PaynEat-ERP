import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import { APP_CONFIG } from '../config/config.token';
import type { RootConfig } from '../config/configuration';
import { APP_NAME, GENERIC_EVENT, TelemetryLogger } from './telemetry-logger';

/**
 * Prometheus metrics (docs/TELEMETRY.md v1.1), served as `GET /metrics` on their own
 * port — never the public API port. docker-compose.yml does not publish it; a scraper
 * reaches it inside the network, which is what "not exposed publicly" means here.
 *
 * Each application instance has its own registry rather than prom-client's global one,
 * so that booting the app twice in one process (the end-to-end suite does) does not
 * register the same metric twice.
 */
@Injectable()
export class MetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly registry = new Registry();

  private readonly requests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled, by route template and status.',
    labelNames: ['app', 'method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  private readonly duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by route template.',
    labelNames: ['app', 'method', 'route'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  /** Every refused sign-in: wrong password or code, unknown account, locked or disabled. */
  private readonly signInFailures = new Counter({
    name: 'auth_sign_in_failures_total',
    help: 'Sign-in attempts refused.',
    labelNames: ['app'] as const,
    registers: [this.registry],
  });

  private server?: Server;

  constructor(
    @Inject(APP_CONFIG) private readonly config: RootConfig,
    private readonly logger: TelemetryLogger,
  ) {
    collectDefaultMetrics({ register: this.registry });
    // Present at zero from the start: "no failures yet" must read as 0, never as missing.
    this.signInFailures.inc({ app: APP_NAME }, 0);
  }

  /** `route` must be a template (`/documents/:id`), never a concrete path. */
  observeRequest(method: string, route: string, status: number, seconds: number): void {
    this.requests.inc({ app: APP_NAME, method, route, status: String(status) });
    this.duration.observe({ app: APP_NAME, method, route }, seconds);
  }

  countSignInFailure(): void {
    this.signInFailures.inc({ app: APP_NAME });
  }

  async onApplicationBootstrap(): Promise<void> {
    this.server = createServer((req, res) => {
      if (req.method === 'GET' && req.url?.split('?')[0] === '/metrics') {
        this.registry
          .metrics()
          .then((body) => {
            res.writeHead(200, { 'Content-Type': this.registry.contentType });
            res.end(body);
          })
          .catch(() => {
            res.writeHead(500).end();
          });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(this.config.telemetry.metricsPort, '0.0.0.0', resolve),
    );
    this.logger.write({
      severity: 'INFO',
      event: GENERIC_EVENT,
      message: `Metrics served on :${this.port()}/metrics (not the API port)`,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  /** The port actually bound — the configured one, or a free one when configured as 0. */
  port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }
}
