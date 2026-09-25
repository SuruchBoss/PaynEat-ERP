// Adapted from Cwork (backend/src/core/prisma/prisma.service.ts), see NOTICE.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around PrismaClient.
 *
 * Prisma is for schema, migrations and ordinary reads and writes. The stock ledger is
 * the exception (ADR-0003, ADR-0010): from #7, only the ledger module writes ledger and
 * balance tables, and only in raw SQL inside one transaction.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    (this as unknown as { $on: (e: string, cb: (ev: { message: string }) => void) => void }).$on(
      'warn',
      (event) => this.logger.warn(event.message),
    );
    (this as unknown as { $on: (e: string, cb: (ev: { message: string }) => void) => void }).$on(
      'error',
      (event) => this.logger.error(event.message),
    );
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
