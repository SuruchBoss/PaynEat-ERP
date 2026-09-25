import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type ComponentStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'unavailable';
  api: ComponentStatus;
  database: ComponentStatus;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** The API is up if it can answer at all; the database is up if it answers `SELECT 1` in time. */
  async check(timeoutMs = 3000): Promise<HealthReport> {
    const database = await this.pingDatabase(timeoutMs);
    return { status: database === 'up' ? 'ok' : 'unavailable', api: 'up', database };
  }

  private async pingDatabase(timeoutMs: number): Promise<ComponentStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ComponentStatus>((resolve) => {
      timer = setTimeout(() => resolve('down'), timeoutMs);
    });
    const ping = this.prisma.$queryRaw`SELECT 1`
      .then((): ComponentStatus => 'up')
      .catch((): ComponentStatus => 'down');
    try {
      return await Promise.race([ping, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
