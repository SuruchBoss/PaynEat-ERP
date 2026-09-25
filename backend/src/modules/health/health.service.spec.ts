import { PrismaService } from '../../core/prisma/prisma.service';
import { HealthService } from './health.service';

/** Only `$queryRaw` is touched; the rest of the client is irrelevant to a ping. */
const prismaAnswering = (answer: () => Promise<unknown>): PrismaService =>
  ({ $queryRaw: () => answer() }) as unknown as PrismaService;

describe('HealthService', () => {
  it('is ok when the database answers', async () => {
    const health = new HealthService(prismaAnswering(() => Promise.resolve([{ '?column?': 1 }])));
    await expect(health.check()).resolves.toEqual({ status: 'ok', api: 'up', database: 'up' });
  });

  it('reports the database down when it refuses', async () => {
    const health = new HealthService(prismaAnswering(() => Promise.reject(new Error('refused'))));
    await expect(health.check()).resolves.toEqual({
      status: 'unavailable',
      api: 'up',
      database: 'down',
    });
  });

  it('reports the database down when it does not answer in time', async () => {
    const health = new HealthService(prismaAnswering(() => new Promise(() => undefined)));
    await expect(health.check(20)).resolves.toMatchObject({ database: 'down' });
  });
});
