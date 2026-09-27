// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
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

  /**
   * Every posting and reversal attempted, by document type and outcome (`succeeded`,
   * `refused`), and for a refusal the rule that refused it (#7, ADR-0011). `rule` is empty
   * for a posting that succeeded.
   */
  private readonly postings = new Counter({
    name: 'erp_postings_total',
    help: 'Stock document postings attempted, by document type, outcome and refusing rule.',
    labelNames: ['document_type', 'outcome', 'rule'] as const,
    registers: [this.registry],
  });

  /**
   * Every sales event a POS delivered (#9, docs/TELEMETRY.md): `received` the first time,
   * `duplicate` when its idempotency key was already stored, `rejected` with the `reason`.
   */
  private readonly salesEvents = new Counter({
    name: 'erp_sales_events_total',
    help: 'Sales events delivered by POS instances, by outcome and refusal reason.',
    labelNames: ['outcome', 'reason'] as const,
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
    this.salesEvents.inc({ outcome: 'received', reason: '' }, 0);
    this.salesEvents.inc({ outcome: 'duplicate', reason: '' }, 0);
  }

  /** `route` must be a template (`/documents/:id`), never a concrete path. */
  observeRequest(method: string, route: string, status: number, seconds: number): void {
    this.requests.inc({ app: APP_NAME, method, route, status: String(status) });
    this.duration.observe({ app: APP_NAME, method, route }, seconds);
  }

  countSignInFailure(): void {
    this.signInFailures.inc({ app: APP_NAME });
  }

  /** `by` 0 makes the series exist before anything happened, so "none yet" reads as 0. */
  countPosting(documentType: string, outcome: 'succeeded' | 'refused', rule = '', by = 1): void {
    this.postings.inc({ document_type: documentType, outcome, rule }, by);
  }

  countSalesEvent(outcome: 'received' | 'duplicate' | 'rejected', reason = ''): void {
    this.salesEvents.inc({ outcome, reason });
  }

  /**
   * A gauge that describes the system rather than this process, so it is read from the
   * database each time metrics are scraped (docs/TELEMETRY.md): several replicas report the same
   * value, and a restart never blanks it. `read` returns every series with its value.
   */
  gaugeFromDatabase<L extends string>(
    name: string,
    help: string,
    labelNames: readonly L[],
    read: () => Promise<Array<{ labels: Record<L, string>; value: number }>>,
  ): void {
    const logger = this.logger;
    new Gauge<L>({
      name,
      help,
      labelNames,
      registers: [this.registry],
      async collect() {
        let series: Awaited<ReturnType<typeof read>>;
        try {
          series = await read();
        } catch (error) {
          // One unreadable gauge must not take every other metric down with it: the series
          // disappear for this scrape, which an investigator reads as "missing", never as 0.
          this.reset();
          logger.write({
            severity: 'WARNING',
            event: GENERIC_EVENT,
            message: `Could not read ${name} from the database`,
            error,
          });
          return;
        }
        this.reset();
        for (const { labels, value } of series) this.set(labels as never, value);
      },
    });
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
