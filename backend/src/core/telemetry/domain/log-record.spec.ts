import {
  acceptRequestId,
  formatLatency,
  isEnabled,
  LogEntry,
  parseTraceparent,
  requestPath,
  severityForStatus,
  toLogRecord,
} from './log-record';

describe('log record (docs/TELEMETRY.md v1.1)', () => {
  describe('severityForStatus', () => {
    it.each([
      [200, 'INFO'],
      [201, 'INFO'],
      [304, 'INFO'],
      [401, 'INFO'],
      [404, 'INFO'],
      [400, 'WARNING'],
      [403, 'WARNING'],
      [409, 'WARNING'],
      [422, 'WARNING'],
      [500, 'ERROR'],
      [503, 'ERROR'],
    ])('HTTP %i is %s', (status, severity) => {
      expect(severityForStatus(status)).toBe(severity);
    });
  });

  it('formats latency as a duration string in seconds', () => {
    expect(formatLatency(231.4)).toBe('0.231s');
    expect(formatLatency(4)).toBe('0.004s');
    expect(formatLatency(1500)).toBe('1.500s');
    expect(formatLatency(-3)).toBe('0.000s');
  });

  it('keeps only the path of a URL', () => {
    expect(requestPath('/items/7?search=chicken&token=abc')).toBe('/items/7');
    expect(requestPath('/health')).toBe('/health');
    expect(requestPath('/a#fragment')).toBe('/a');
  });

  it('accepts only request ids matching ^[\\w-]{8,64}$', () => {
    expect(acceptRequestId('abcd-1234')).toBe('abcd-1234');
    expect(acceptRequestId('a'.repeat(64))).toBe('a'.repeat(64));
    expect(acceptRequestId('short')).toBeUndefined();
    expect(acceptRequestId('a'.repeat(65))).toBeUndefined();
    expect(acceptRequestId('has space 123')).toBeUndefined();
    expect(acceptRequestId('<script>alert(1)</script>')).toBeUndefined();
    expect(acceptRequestId(['abcd-1234'])).toBeUndefined();
    expect(acceptRequestId(undefined)).toBeUndefined();
  });

  it('reads the trace id of a W3C traceparent', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBe(
      undefined,
    );
    expect(parseTraceparent('not-a-traceparent')).toBeUndefined();
    expect(parseTraceparent(undefined)).toBeUndefined();
  });

  it('filters by severity threshold', () => {
    expect(isEnabled('INFO', 'DEBUG')).toBe(false);
    expect(isEnabled('INFO', 'INFO')).toBe(true);
    expect(isEnabled('WARNING', 'ERROR')).toBe(true);
    expect(isEnabled('ERROR', 'WARNING')).toBe(false);
  });

  describe('toLogRecord', () => {
    const entry: LogEntry = {
      severity: 'INFO',
      time: new Date('2026-09-25T10:15:30.123Z'),
      message: 'GET /health 200',
      labels: {
        app: 'payneat-erp-api',
        event: 'http.request.completed',
        correlation_id: 'req-0001-abcd',
        location_code: '',
      },
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      httpRequest: { requestMethod: 'GET', requestUrl: '/health', status: 200, latency: '0.004s' },
    };

    it('writes plain labels and trace by default, with no vendor keys', () => {
      expect(toLogRecord(entry, { format: 'default', includeStack: false })).toEqual({
        severity: 'INFO',
        time: '2026-09-25T10:15:30.123Z',
        message: 'GET /health 200',
        labels: {
          app: 'payneat-erp-api',
          event: 'http.request.completed',
          correlation_id: 'req-0001-abcd',
        },
        trace: '4bf92f3577b34da6a3ce929d0e0e4736',
        httpRequest: {
          requestMethod: 'GET',
          requestUrl: '/health',
          status: 200,
          latency: '0.004s',
        },
      });
    });

    it('moves labels and trace to the Cloud Logging keys with LOG_FORMAT=gcp', () => {
      const record = toLogRecord(entry, {
        format: 'gcp',
        gcpProject: 'demo-project',
        includeStack: false,
      });
      expect(record).not.toHaveProperty('labels');
      expect(record).not.toHaveProperty('trace');
      expect(record['logging.googleapis.com/labels']).toEqual({
        app: 'payneat-erp-api',
        event: 'http.request.completed',
        correlation_id: 'req-0001-abcd',
      });
      expect(record['logging.googleapis.com/trace']).toBe(
        'projects/demo-project/traces/4bf92f3577b34da6a3ce929d0e0e4736',
      );
    });

    it('keeps a plain trace in gcp format when no project id is configured', () => {
      const record = toLogRecord(entry, { format: 'gcp', includeStack: false });
      expect(record.trace).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(record).not.toHaveProperty('logging.googleapis.com/trace');
    });

    it('writes an error stack only when asked to (LOG_LEVEL=DEBUG)', () => {
      const failing: LogEntry = {
        ...entry,
        severity: 'ERROR',
        error: { type: 'Error', message: 'boom', stack: 'Error: boom\n    at x' },
      };
      expect(toLogRecord(failing, { format: 'default', includeStack: false }).error).toEqual({
        type: 'Error',
        message: 'boom',
      });
      expect(toLogRecord(failing, { format: 'default', includeStack: true }).error).toEqual({
        type: 'Error',
        message: 'boom',
        stack: 'Error: boom\n    at x',
      });
    });
  });
});
