import { z } from 'zod';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';

/** The body of `GET /health` (backend `modules/health`), on 200 and on 503 alike. */
export const healthReportSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  api: z.enum(['up', 'down']),
  database: z.enum(['up', 'down']),
});

export type HealthReport = z.infer<typeof healthReportSchema>;

export interface HealthCheck {
  report: HealthReport;
  /** The correlation id the API returned for this check. */
  requestId?: string;
}

/**
 * Asks the API how it and its database are. A 503 is an answer — the API is up and says
 * its database is not — so it is returned, not thrown; anything else that is not a
 * well-formed report is an `ApiError`.
 */
export async function fetchHealth(): Promise<HealthCheck> {
  const response = await api.request<unknown>('GET', '/health', {
    unversioned: true,
    acceptStatus: [503],
  });
  const parsed = healthReportSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', '', undefined, response.requestId);
  }
  return { report: parsed.data, requestId: response.requestId };
}
