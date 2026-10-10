// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';
import { BusinessRuleError, ConflictError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import { normaliseDecimal } from '../../core/quantity/domain/stock-value';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { AuditService } from '../audit/audit.service';
import { thresholdProblem } from './domain/company-settings-rules';
import type { CompanySettingsView, UpdateCompanySettingsDto } from './dto/company.dto';

const DEFAULT_THRESHOLD = '0.00';
/** ADR-0030: what a POS clock a little fast looks like. The admin may change it. */
const DEFAULT_SALE_TIME_TOLERANCE_MINUTES = 10;

const THRESHOLD_ERRORS = {
  THRESHOLD_NOT_A_NUMBER: 'The approval threshold must be an amount, written like 20000.00',
  THRESHOLD_NEGATIVE: 'The approval threshold cannot be below zero',
  THRESHOLD_TOO_PRECISE: 'The approval threshold has at most two decimals',
  THRESHOLD_TOO_LARGE: 'The approval threshold is too large',
} as const;

/**
 * The company's settings (#10): configuration the admin maintains, never constants in code
 * (ADR-0008). Owns `company_settings`. Until the admin first saves them, the defaults apply:
 * a purchase approval threshold of zero, so every order goes to an approver.
 */
@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async settings(): Promise<CompanySettingsView> {
    const row = await this.prisma.companySettings.findUnique({
      where: { singleton: true },
      include: { updatedBy: { select: { id: true, displayName: true } } },
    });
    if (!row) {
      return {
        purchaseApprovalThreshold: DEFAULT_THRESHOLD,
        saleTimeAheadToleranceMinutes: DEFAULT_SALE_TIME_TOLERANCE_MINUTES,
        revision: 0,
        updated: null,
      };
    }
    return {
      purchaseApprovalThreshold: row.purchaseApprovalThreshold.toFixed(2),
      saleTimeAheadToleranceMinutes: row.saleTimeAheadToleranceMinutes,
      revision: row.revision,
      updated: { by: row.updatedBy, at: row.updatedAt },
    };
  }

  /**
   * The purchase approval threshold in force, read inside the caller's transaction so a
   * submission is judged against the value it records (#10).
   */
  async purchaseApprovalThreshold(tx: Prisma.TransactionClient = this.prisma): Promise<string> {
    const row = await tx.companySettings.findUnique({
      where: { singleton: true },
      select: { purchaseApprovalThreshold: true },
    });
    return row ? row.purchaseApprovalThreshold.toFixed(2) : DEFAULT_THRESHOLD;
  }

  /** The sale-time tolerance in force, in minutes (#17, ADR-0030). */
  async saleTimeAheadToleranceMinutes(tx: Prisma.TransactionClient = this.prisma): Promise<number> {
    const row = await tx.companySettings.findUnique({
      where: { singleton: true },
      select: { saleTimeAheadToleranceMinutes: true },
    });
    return row?.saleTimeAheadToleranceMinutes ?? DEFAULT_SALE_TIME_TOLERANCE_MINUTES;
  }

  async updateSettings(
    dto: UpdateCompanySettingsDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<CompanySettingsView> {
    const problem = thresholdProblem(dto.purchaseApprovalThreshold);
    if (problem) {
      throw new BusinessRuleError('INVALID_APPROVAL_THRESHOLD', THRESHOLD_ERRORS[problem], {
        problem,
      });
    }
    const threshold = normaliseDecimal(dto.purchaseApprovalThreshold);
    await this.prisma.$transaction(async (tx) => {
      // Locked, so two admins saving at once cannot both pass the revision check.
      const current = await tx.$queryRaw<
        { revision: number; threshold: string; tolerance: number }[]
      >`
        SELECT "revision", "purchase_approval_threshold"::text AS "threshold",
               "sale_time_ahead_tolerance_minutes" AS "tolerance"
          FROM "company_settings" WHERE "singleton" FOR UPDATE`;
      const revision = current[0]?.revision ?? 0;
      if (revision !== dto.revision) {
        throw new ConflictError(
          'COMPANY_SETTINGS_CHANGED',
          'The settings were changed by someone else since you opened them. Reload them and try again.',
          { currentRevision: revision },
        );
      }
      const from = current[0]?.threshold ?? DEFAULT_THRESHOLD;
      const toleranceFrom = current[0]?.tolerance ?? DEFAULT_SALE_TIME_TOLERANCE_MINUTES;
      const tolerance = dto.saleTimeAheadToleranceMinutes ?? toleranceFrom;
      await tx.companySettings.upsert({
        where: { singleton: true },
        create: {
          purchaseApprovalThreshold: threshold,
          saleTimeAheadToleranceMinutes: tolerance,
          updatedById: actor.userId,
        },
        update: {
          purchaseApprovalThreshold: threshold,
          saleTimeAheadToleranceMinutes: tolerance,
          updatedById: actor.userId,
          revision: { increment: 1 },
        },
      });
      const changes: Record<string, { from: string | number; to: string | number }> = {};
      if (from !== threshold) changes.purchaseApprovalThreshold = { from, to: threshold };
      if (toleranceFrom !== tolerance) {
        changes.saleTimeAheadToleranceMinutes = { from: toleranceFrom, to: tolerance };
      }
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'CompanySettings',
        entityId: null,
        summary: settingsSummary(changes, threshold, tolerance),
        changes:
          Object.keys(changes).length > 0
            ? changes
            : { purchaseApprovalThreshold: { from, to: threshold } },
        ...meta,
      });
    });
    return this.settings();
  }
}

function settingsSummary(
  changes: Record<string, unknown>,
  threshold: string,
  tolerance: number,
): string {
  const tolerancePart = `the sale-time tolerance to ${tolerance} minutes`;
  if (!('saleTimeAheadToleranceMinutes' in changes)) {
    return `Set the purchase approval threshold to ${threshold}`;
  }
  return 'purchaseApprovalThreshold' in changes
    ? `Set the purchase approval threshold to ${threshold} and ${tolerancePart}`
    : `Set ${tolerancePart}`;
}
