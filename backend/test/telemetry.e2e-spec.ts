/**
 * The telemetry contract, end to end: docs/TELEMETRY.md v1.1 as seen from outside —
 * the headers a caller gets back, the lines the API writes, and the metrics it serves.
 */
import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
} from '@nestjs/common';
import request from 'supertest';
import { Public } from 'src/core/security/decorators';
import { completedLine, createTestApp, TestContext } from './utils/test-app';

/**
 * Responses no production route gives yet: a 400, a 500, and a route with a parameter.
 * Public, so the telemetry of a request is tested apart from signing in.
 */
@Public()
@Controller('test-only')
class TestOnlyController {
  @Get('bad-request')
  badRequest(): never {
    throw new BadRequestException('bad input');
  }

  @Get('crash')
  crash(): never {
    throw new Error('the database fell over');
  }

  @Get('http-500')
  http500(): never {
    throw new InternalServerErrorException();
  }

  @Get('items/:id')
  item(@Param('id') id: string): { id: string } {
    return { id };
  }
}

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`;
const RFC3339_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('telemetry contract v1.1 — default format', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [TestOnlyController] });
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('x-request-id', () => {
    it('echoes a valid incoming id', async () => {
      const res = await request(ctx.server).get('/health').set('x-request-id', 'client-req-0001');
      expect(res.headers['x-request-id']).toBe('client-req-0001');
      expect(completedLine(ctx, 'client-req-0001').labels.correlation_id).toBe('client-req-0001');
    });

    it('replaces an id that does not match ^[\\w-]{8,64}$', async () => {
      const res = await request(ctx.server).get('/health').set('x-request-id', 'bad id!');
      expect(res.headers['x-request-id']).not.toBe('bad id!');
      expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
    });

    it('generates one when the caller sends none', async () => {
      const res = await request(ctx.server).get('/health');
      expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
    });

    it('is in the error body, next to a path without its query string', async () => {
      const res = await request(ctx.server)
        .get('/api/v1/no-such-route?token=abc')
        .set('x-request-id', 'client-req-0404');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        code: 'RESOURCE_NOT_FOUND',
        requestId: 'client-req-0404',
        path: '/api/v1/no-such-route',
      });
    });
  });

  describe('log lines', () => {
    it('writes http.request.completed with the contract fields', async () => {
      await request(ctx.server)
        .get('/health?probe=1')
        .set('x-request-id', 'client-req-shape')
        .set('traceparent', TRACEPARENT);

      const line = completedLine(ctx, 'client-req-shape');
      expect(line.severity).toBe('INFO');
      expect(line.time).toMatch(RFC3339_MS);
      expect(typeof line.message).toBe('string');
      expect(line.labels).toEqual({
        app: 'payneat-erp-api',
        event: 'http.request.completed',
        correlation_id: 'client-req-shape',
      });
      expect(line.trace).toBe(TRACE_ID);
      expect(line.httpRequest).toEqual({
        requestMethod: 'GET',
        requestUrl: '/health',
        status: 200,
        latency: expect.stringMatching(/^\d+\.\d{3}s$/),
      });
      expect(line).not.toHaveProperty('logging.googleapis.com/labels');
      expect(line).not.toHaveProperty('logging.googleapis.com/trace');
    });

    it('maps status to severity: 404 INFO, 400 WARNING, 500 ERROR', async () => {
      await request(ctx.server).get('/api/v1/missing').set('x-request-id', 'sev-404-00');
      await request(ctx.server)
        .get('/api/v1/test-only/bad-request')
        .set('x-request-id', 'sev-400-00');
      await request(ctx.server).get('/api/v1/test-only/http-500').set('x-request-id', 'sev-500-00');

      expect(completedLine(ctx, 'sev-404-00').severity).toBe('INFO');
      expect(completedLine(ctx, 'sev-400-00').severity).toBe('WARNING');
      expect(completedLine(ctx, 'sev-500-00').severity).toBe('ERROR');
    });

    it('reports a crash as { type, message } with no stack at INFO, and hides it from the caller', async () => {
      const res = await request(ctx.server)
        .get('/api/v1/test-only/crash')
        .set('x-request-id', 'crash-0001');

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR', requestId: 'crash-0001' });
      expect(JSON.stringify(res.body)).not.toContain('fell over');

      const line = completedLine(ctx, 'crash-0001');
      expect(line.severity).toBe('ERROR');
      expect(line.error).toEqual({ type: 'Error', message: 'the database fell over' });
    });

    it('gives every line a string severity, a time, a message and the three required labels', () => {
      const lines = ctx.logs();
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(['DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL']).toContain(
          line.severity,
        );
        expect(line.time).toMatch(RFC3339_MS);
        expect(typeof line.message).toBe('string');
        expect(line.labels).toEqual(
          expect.objectContaining({
            app: 'payneat-erp-api',
            event: expect.any(String),
            correlation_id: expect.any(String),
          }),
        );
      }
    });

    it('never writes what the contract lists under "never in logs or labels"', async () => {
      const secrets = [
        'hunter2-pass',
        'tok-9f8e7d6c',
        'Bearer abc.def.ghi',
        'session=s3cr3t',
        'สมชาย',
      ];
      await request(ctx.server)
        .get('/api/v1/test-only/items/42?password=hunter2-pass&token=tok-9f8e7d6c')
        .set('Authorization', 'Bearer abc.def.ghi')
        .set('Cookie', 'session=s3cr3t')
        .set('x-request-id', 'secrets-0001');
      await request(ctx.server)
        .post('/api/v1/test-only/items/42')
        .send({ name: 'สมชาย', password: 'hunter2-pass' })
        .set('x-request-id', 'secrets-0002');

      const everything = ctx.rawLogs.join('\n');
      for (const secret of secrets) expect(everything).not.toContain(secret);
      expect(everything).not.toContain(process.env.DATABASE_URL as string);
      expect(completedLine(ctx, 'secrets-0001').httpRequest.requestUrl).toBe(
        '/api/v1/test-only/items/42',
      );
    });
  });

  describe('GET /metrics', () => {
    const scrape = async (): Promise<string> => {
      const res = await request(`http://127.0.0.1:${ctx.metricsPort}`).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      return res.text;
    };

    it('counts requests by route template, never by concrete path', async () => {
      await request(ctx.server).get('/health');
      await request(ctx.server).get('/api/v1/test-only/items/12345');
      await request(ctx.server).get('/api/v1/no-such-thing/987654');

      const text = await scrape();
      expect(text).toContain(
        'http_requests_total{app="payneat-erp-api",method="GET",route="/health",status="200"}',
      );
      expect(text).toContain('route="/api/v1/test-only/items/:id"');
      expect(text).toContain('route="unmatched"');
      expect(text).toMatch(
        /http_request_duration_seconds_bucket\{le="[^"]+",app="payneat-erp-api",method="GET",route="\/health"\}/,
      );
      expect(text).not.toContain('12345');
      expect(text).not.toContain('987654');
    });

    it('is not served on the public API port', async () => {
      expect((await request(ctx.server).get('/metrics')).status).toBe(404);
    });
  });
});

describe('telemetry contract v1.1 — LOG_FORMAT=gcp', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({
      env: { LOG_FORMAT: 'gcp', GOOGLE_CLOUD_PROJECT: 'demo-project' },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('writes the same labels under logging.googleapis.com/labels, and the trace as a resource name', async () => {
    await request(ctx.server)
      .get('/health')
      .set('x-request-id', 'gcp-req-0001')
      .set('traceparent', TRACEPARENT);

    const line = completedLine(ctx, 'gcp-req-0001');
    expect(line.severity).toBe('INFO');
    expect(line['logging.googleapis.com/labels']).toEqual({
      app: 'payneat-erp-api',
      event: 'http.request.completed',
      correlation_id: 'gcp-req-0001',
    });
    expect(line['logging.googleapis.com/trace']).toBe(`projects/demo-project/traces/${TRACE_ID}`);
    expect(line).not.toHaveProperty('labels');
    expect(line).not.toHaveProperty('trace');
    expect(line.httpRequest.latency).toMatch(/^\d+\.\d{3}s$/);
  });

  it('writes every line in the gcp shape', () => {
    for (const line of ctx.logs()) {
      expect(line).not.toHaveProperty('labels');
      expect(line['logging.googleapis.com/labels']).toEqual(
        expect.objectContaining({ app: 'payneat-erp-api' }),
      );
    }
  });
});

describe('telemetry contract v1.1 — LOG_LEVEL=DEBUG', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ env: { LOG_LEVEL: 'DEBUG' }, controllers: [TestOnlyController] });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('adds the stack to a failure only at DEBUG', async () => {
    await request(ctx.server).get('/api/v1/test-only/crash').set('x-request-id', 'crash-debug-01');
    const line = completedLine(ctx, 'crash-debug-01');
    expect(line.error.stack).toContain('the database fell over');
  });
});
