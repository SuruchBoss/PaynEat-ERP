// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import { AuditAction, BomSide, LocationType, Prisma } from '@prisma/client';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import type { ExactDecimal } from '../../core/quantity/domain/exact-decimal';
import { isIsoDate } from '../../core/time/domain/business-date';
import {
  hasTakenEffect,
  newVersionProblem,
  versionInEffect,
  versionStatus,
} from '../../core/time/domain/dated-versions';
import { AuditService } from '../audit/audit.service';
import { ItemsService, type ItemFacts } from '../items/items.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  allocationRatios,
  bomFigures,
  bomIssues,
  defaultRatios,
  formatKg,
  lineWeightKg,
  normaliseQuantity,
  statedRatioTotal,
  yieldPercent,
  type BomOutputInput,
} from './domain/bom-rules';
import type {
  BomLineView,
  BomLinesDto,
  BomLocationType,
  BomPreviewView,
  BomVersionView,
  CreateBomVersionDto,
  CreateProductionBomDto,
  ProductionBomSummaryView,
  ProductionBomView,
  ProductionBomsQueryDto,
  UpdateProductionBomDto,
} from './dto/production-boms.dto';

const LINE_SELECT = {
  side: true,
  lineNo: true,
  itemId: true,
  quantity: true,
  expectedWeightKg: true,
  allocationRatio: true,
} satisfies Prisma.ProductionBomLineSelect;

const VERSION_SELECT = {
  id: true,
  bomId: true,
  number: true,
  effectiveFrom: true,
  ratiosOverridden: true,
  lines: { select: LINE_SELECT, orderBy: [{ side: 'asc' }, { lineNo: 'asc' }] },
} satisfies Prisma.ProductionBomVersionSelect;

const BOM_SELECT = {
  id: true,
  code: true,
  nameTh: true,
  nameEn: true,
  locationType: true,
  active: true,
  revision: true,
  versions: { select: VERSION_SELECT, orderBy: { effectiveFrom: 'desc' } },
} satisfies Prisma.ProductionBomSelect;

type VersionRow = Prisma.ProductionBomVersionGetPayload<{ select: typeof VERSION_SELECT }>;
type BomRow = Prisma.ProductionBomGetPayload<{ select: typeof BOM_SELECT }>;

/**
 * A BOM version as a production order follows it (#13): its lines in order, each output with
 * the ratio it carries, and the weights the order's yield is measured against.
 */
export interface BomVersionForOrder {
  bom: { id: string; code: string; nameTh: string; nameEn: string; active: boolean };
  locationType: BomLocationType;
  version: { id: string; number: number; effectiveFrom: string };
  inputs: Array<{
    lineNo: number;
    itemId: string;
    quantity: string;
    expectedWeightKg: string | null;
  }>;
  outputs: Array<{
    lineNo: number;
    itemId: string;
    quantity: string;
    expectedWeightKg: string | null;
    allocationRatio: string;
  }>;
  /** Exact, per batch. */
  expected: { inputWeightKg: ExactDecimal; outputWeightsKg: ExactDecimal[] };
}

/** A line as it is stored and compared: decimals in their shortest exact spelling. */
interface StoredLine {
  side: BomSide;
  lineNo: number;
  itemId: string;
  quantity: string;
  expectedWeightKg: string | null;
  allocationRatio: string | null;
}

/**
 * Production BOMs (#12, ADR-0004, ADR-0023, ADR-0026): how the plant turns inputs into
 * outputs, with each output's expected yield and the share of the batch cost it carries. A
 * version is in force from its effective-from date until the next one starts; versions never
 * start on the same day, never in the past, and never change once in force, so a production
 * order can always show the version it used. Every change commits with its audit entry or
 * not at all. BOMs are not master data: no POS mirrors them.
 */
@Injectable()
export class ProductionBomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
    private readonly ledger: LedgerService,
  ) {}

  async list(query: ProductionBomsQueryDto): Promise<ProductionBomSummaryView[]> {
    const rows = await this.prisma.productionBom.findMany({
      where: query.includeInactive ? {} : { active: true },
      select: BOM_SELECT,
      orderBy: { code: 'asc' },
    });
    const items = await this.items.describe(itemIdsOf(rows.flatMap((r) => r.versions)));
    const today = this.ledger.today();
    return rows.map((row) => {
      const dated = row.versions.map((v) => ({ v, effectiveFrom: dateText(v.effectiveFrom) }));
      const current = versionInEffect(dated, today);
      const next = dated
        .filter((d) => versionStatus(d, dated, today) === 'scheduled')
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
      return {
        ...header(row),
        current: current
          ? {
              number: current.v.number,
              effectiveFrom: current.effectiveFrom,
              yieldPercent: versionView(current.v, dated, items, today).yieldPercent,
            }
          : null,
        scheduled: next ? { number: next.v.number, effectiveFrom: next.effectiveFrom } : null,
      };
    });
  }

  /** The BOM with every version, newest first. */
  async get(id: string): Promise<ProductionBomView> {
    const row = await this.prisma.productionBom.findUnique({ where: { id }, select: BOM_SELECT });
    if (!row) throw new NotFoundError('ProductionBom', id);
    const items = await this.items.describe(itemIdsOf(row.versions));
    const today = this.ledger.today();
    const dated = row.versions.map((v) => ({ v, effectiveFrom: dateText(v.effectiveFrom) }));
    return {
      ...header(row),
      today,
      versions: dated.map(({ v }) => versionView(v, dated, items, today)),
    };
  }

  /**
   * The version of a BOM in force on a business date, as a production order follows it (#13);
   * null when none is in force that day.
   */
  async versionForOrder(bomId: string, businessDate: string): Promise<BomVersionForOrder | null> {
    const row = await this.prisma.productionBom.findUnique({
      where: { id: bomId },
      select: BOM_SELECT,
    });
    if (!row) throw new NotFoundError('ProductionBom', bomId);
    const dated = row.versions.map((v) => ({ v, effectiveFrom: dateText(v.effectiveFrom) }));
    const current = versionInEffect(dated, businessDate);
    if (!current) return null;
    const items = await this.items.describe(itemIdsOf([current.v]));
    return forOrder(row, current.v, items);
  }

  /** Versions by id, as the orders that recorded them follow them. */
  async versionsForOrders(ids: readonly string[]): Promise<Map<string, BomVersionForOrder>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.productionBomVersion.findMany({
      where: { id: { in: unique } },
      select: { ...VERSION_SELECT, bom: { select: BOM_SELECT } },
    });
    const items = await this.items.describe(itemIdsOf(rows));
    return new Map(rows.map((row) => [row.id, forOrder(row.bom, row, items)]));
  }

  /** What a version would give, with every problem it has; refuses nothing and writes nothing. */
  async preview(dto: BomLinesDto): Promise<BomPreviewView> {
    const items = await this.items.describe([...dto.inputs, ...dto.outputs].map((l) => l.itemId));
    const { lines: issues, problems, zeroRatioOutputs } = bomIssues(dto.inputs, dto.outputs, items);
    const stated = statedRatioTotal(dto.outputs);
    if (issues.length > 0) {
      return { issues, problems, zeroRatioOutputs, figures: null, statedRatioTotal: stated };
    }
    const figures = bomFigures(dto.inputs, dto.outputs, items);
    const defaults = defaultRatios(figures.outputWeights);
    return {
      issues,
      problems,
      zeroRatioOutputs,
      figures: {
        inputWeightKg: formatKg(figures.inputWeight),
        outputWeightKg: formatKg(figures.outputWeight),
        wasteKg: formatKg(figures.waste),
        yieldPercent: yieldPercent(figures),
        outputs: figures.outputWeights.map((weight, index) => ({
          weightKg: formatKg(weight),
          yieldPercent: yieldPercent({ inputWeight: figures.inputWeight, outputWeight: weight }),
          defaultRatio: defaults[index],
        })),
      },
      statedRatioTotal: stated,
    };
  }

  /** A new BOM with its first version, which starts today at the earliest. */
  async create(
    dto: CreateProductionBomDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionBomView> {
    checkDate(dto.effectiveFrom);
    const items = await this.validLines(dto);
    const problem = newVersionProblem([], dto.effectiveFrom, this.ledger.today());
    if (problem) throwVersionProblem(problem);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const bom = await tx.productionBom.create({
          data: {
            code: dto.code,
            nameTh: dto.nameTh,
            nameEn: dto.nameEn,
            locationType: dto.locationType as LocationType,
          },
          select: { id: true },
        });
        const version = await tx.productionBomVersion.create({
          data: {
            bomId: bom.id,
            number: 1,
            effectiveFrom: dateValue(dto.effectiveFrom),
            ...versionData(dto, items),
          },
          select: VERSION_SELECT,
        });
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.CREATE,
          entityType: 'ProductionBom',
          entityId: bom.id,
          summary: `Created production BOM ${dto.code} (${dto.nameEn}), version 1 from ${dto.effectiveFrom}`,
          changes: {
            bomCode: dto.code,
            nameTh: dto.nameTh,
            nameEn: dto.nameEn,
            locationType: dto.locationType,
            version: snapshot(version, items),
          },
          ...meta,
        });
        return bom.id;
      });
      return this.get(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          'PRODUCTION_BOM_CODE_TAKEN',
          `A production BOM with code ${dto.code} already exists`,
          { field: 'code' },
        );
      }
      throw error;
    }
  }

  /** Changes the names or deactivates (reactivates) the BOM. Its versions are untouched. */
  async update(
    id: string,
    dto: UpdateProductionBomDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionBomView> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockBom(tx, id);
      if (current.revision !== dto.revision) {
        throw new ConflictError(
          'STALE_REVISION',
          'This BOM changed since it was loaded: reload it and make the change again',
          { revision: current.revision },
        );
      }
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of ['nameTh', 'nameEn', 'active'] as const) {
        const value = dto[field];
        if (value !== undefined && value !== current[field]) {
          changes[field] = { from: current[field], to: value };
        }
      }
      if (Object.keys(changes).length === 0) return;
      await tx.productionBom.update({
        where: { id },
        data: {
          nameTh: dto.nameTh,
          nameEn: dto.nameEn,
          active: dto.active,
          revision: { increment: 1 },
        },
      });
      const action =
        changes.active?.to === false
          ? 'Deactivated'
          : changes.active?.to === true
            ? 'Reactivated'
            : 'Changed';
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'ProductionBom',
        entityId: id,
        summary: `${action} production BOM ${current.code}`,
        changes: { bomCode: current.code, ...changes },
        ...meta,
      });
    });
    return this.get(id);
  }

  /**
   * A new version from `effectiveFrom`: today when the BOM has none in force yet, else
   * tomorrow at the earliest, and never on a day another version starts.
   */
  async addVersion(
    id: string,
    dto: CreateBomVersionDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionBomView> {
    checkDate(dto.effectiveFrom);
    const items = await this.validLines(dto);
    const today = this.ledger.today();

    await this.prisma.$transaction(async (tx) => {
      const bom = await this.lockBom(tx, id);
      if (!bom.active) {
        throw new ConflictError(
          'PRODUCTION_BOM_INACTIVE',
          'This BOM is deactivated: reactivate it before adding a version',
        );
      }
      const existing = await tx.productionBomVersion.findMany({
        where: { bomId: id },
        select: { number: true, effectiveFrom: true },
      });
      const problem = newVersionProblem(
        existing.map((v) => ({ effectiveFrom: dateText(v.effectiveFrom) })),
        dto.effectiveFrom,
        today,
      );
      if (problem) throwVersionProblem(problem);

      const version = await tx.productionBomVersion.create({
        data: {
          bomId: id,
          number: Math.max(0, ...existing.map((v) => v.number)) + 1,
          effectiveFrom: dateValue(dto.effectiveFrom),
          ...versionData(dto, items),
        },
        select: VERSION_SELECT,
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.CREATE,
        entityType: 'ProductionBomVersion',
        entityId: version.id,
        summary: `Created version ${version.number} of production BOM ${bom.code}, from ${dto.effectiveFrom}`,
        changes: { bomCode: bom.code, ...snapshot(version, items) },
        ...meta,
      });
    });
    return this.get(id);
  }

  /** Replaces the lines of a version that has not taken effect yet. */
  async correctVersion(
    versionId: string,
    dto: BomLinesDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionBomView> {
    const found = await this.prisma.productionBomVersion.findUnique({
      where: { id: versionId },
      select: { bomId: true },
    });
    if (!found) throw new NotFoundError('ProductionBomVersion', versionId);
    const newItems = await this.validLines(dto);
    const today = this.ledger.today();

    await this.prisma.$transaction(async (tx) => {
      const bom = await this.lockBom(tx, found.bomId);
      const current = await tx.productionBomVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: VERSION_SELECT,
      });
      if (hasTakenEffect({ effectiveFrom: dateText(current.effectiveFrom) }, today)) {
        throw new ConflictError(
          'PRODUCTION_BOM_VERSION_IN_EFFECT',
          'This version is in force or has been: it never changes. Add a new version instead.',
        );
      }
      const before = storedLines(current);
      const data = versionData(dto, newItems);
      const after = data.lines.create.map((line) => ({ ...line }));
      if (
        JSON.stringify(before) === JSON.stringify(after) &&
        current.ratiosOverridden === data.ratiosOverridden
      ) {
        return;
      }

      await tx.productionBomLine.deleteMany({ where: { versionId } });
      await tx.productionBomLine.createMany({
        data: after.map((line) => ({ ...line, versionId })),
      });
      const row = await tx.productionBomVersion.update({
        where: { id: versionId },
        data: { ratiosOverridden: data.ratiosOverridden },
        select: VERSION_SELECT,
      });
      const allItems = await this.items.describe(
        [...before, ...after].map((l) => l.itemId),
        tx,
      );
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'ProductionBomVersion',
        entityId: versionId,
        summary: `Corrected version ${row.number} of production BOM ${bom.code} before it starts`,
        changes: {
          bomCode: bom.code,
          lines: { from: linesSnapshot(before, allItems), to: linesSnapshot(after, allItems) },
          ratiosOverridden: { from: current.ratiosOverridden, to: data.ratiosOverridden },
        },
        ...meta,
      });
    });
    return this.get(found.bomId);
  }

  /** The BOM, locked so two versions of one BOM are numbered one at a time. */
  private async lockBom(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM production_boms WHERE id = ${id}::uuid FOR UPDATE`;
    const bom = await tx.productionBom.findUnique({
      where: { id },
      select: { id: true, code: true, nameTh: true, nameEn: true, active: true, revision: true },
    });
    if (!bom) throw new NotFoundError('ProductionBom', id);
    return bom;
  }

  /** The items the lines name, after checking every line; refused with every problem at once. */
  private async validLines(dto: BomLinesDto): Promise<Map<string, ItemFacts>> {
    const items = await this.items.describe([...dto.inputs, ...dto.outputs].map((l) => l.itemId));
    const issues = bomIssues(dto.inputs, dto.outputs, items);
    if (issues.lines.length > 0 || issues.problems.length > 0) {
      const text = [
        ...issues.problems.map((p) =>
          p === 'default_ratio_zero'
            ? `default ratio zero on output line ${issues.zeroRatioOutputs.join(', ')}`
            : p.replaceAll('_', ' '),
        ),
        ...issues.lines.map((i) => `${i.side} line ${i.lineNo}: ${i.problem.replaceAll('_', ' ')}`),
      ].join('; ');
      throw new BusinessRuleError('INVALID_PRODUCTION_BOM', text, {
        issues: issues.lines,
        problems: issues.problems,
        zeroRatioOutputs: issues.zeroRatioOutputs,
      });
    }
    return items;
  }
}

function checkDate(effectiveFrom: string): void {
  if (!isIsoDate(effectiveFrom)) {
    throw new BusinessRuleError(
      'INVALID_DATE',
      'effectiveFrom must be a real date written YYYY-MM-DD',
      {
        field: 'effectiveFrom',
      },
    );
  }
}

function throwVersionProblem(problem: NonNullable<ReturnType<typeof newVersionProblem>>): never {
  if (problem.reason === 'overlap') {
    throw new ConflictError(
      'PRODUCTION_BOM_VERSION_OVERLAP',
      'Another version of this BOM starts on that day: two versions would be in force at once',
      { field: 'effectiveFrom' },
    );
  }
  throw new BusinessRuleError(
    'PRODUCTION_BOM_TOO_EARLY',
    `A new version starts on ${problem.earliest} at the earliest: a BOM never changes for a day that has begun`,
    { field: 'effectiveFrom', earliest: problem.earliest },
  );
}

/** The lines and ratios of a valid version, as they are stored. */
function versionData(dto: BomLinesDto, items: ReadonlyMap<string, ItemFacts>) {
  const figures = bomFigures(dto.inputs, dto.outputs, items);
  const ratios = allocationRatios(dto.outputs as BomOutputInput[], figures.outputWeights);
  const line = (side: BomSide, l: BomLinesDto['inputs'][number], index: number): StoredLine => ({
    side,
    lineNo: index + 1,
    itemId: l.itemId,
    quantity: normaliseQuantity(l.quantity),
    expectedWeightKg: l.expectedWeightKg ? normaliseQuantity(l.expectedWeightKg) : null,
    allocationRatio: side === BomSide.output ? ratios.ratios[index] : null,
  });
  return {
    ratiosOverridden: ratios.overridden,
    lines: {
      create: [
        ...dto.inputs.map((l, i) => line(BomSide.input, l, i)),
        ...dto.outputs.map((l, i) => line(BomSide.output, l, i)),
      ],
    },
  };
}

function storedLines(row: VersionRow): StoredLine[] {
  return row.lines.map((l) => ({
    side: l.side,
    lineNo: l.lineNo,
    itemId: l.itemId,
    quantity: normaliseQuantity(l.quantity.toFixed()),
    expectedWeightKg: l.expectedWeightKg ? normaliseQuantity(l.expectedWeightKg.toFixed()) : null,
    allocationRatio: l.allocationRatio ? l.allocationRatio.toFixed(2) : null,
  }));
}

function versionView(
  row: VersionRow,
  dated: ReadonlyArray<{ v: VersionRow; effectiveFrom: string }>,
  items: ReadonlyMap<string, ItemFacts>,
  today: string,
): BomVersionView {
  const lines = storedLines(row);
  const inputs = lines.filter((l) => l.side === BomSide.input);
  const outputs = lines.filter((l) => l.side === BomSide.output);
  const figures = bomFigures(inputs, outputs, items);
  const effectiveFrom = dateText(row.effectiveFrom);
  const lineView = (line: StoredLine): BomLineView => {
    const item = items.get(line.itemId)!;
    return {
      lineNo: line.lineNo,
      item: {
        id: item.id,
        code: item.code,
        nameTh: item.nameTh,
        nameEn: item.nameEn,
        baseUnitCode: item.baseUnitCode,
      },
      quantity: line.quantity,
      expectedWeightKg: line.expectedWeightKg ? formatKg(lineWeightKg(line, item)) : null,
      weightKg: formatKg(lineWeightKg(line, item)),
    };
  };
  return {
    id: row.id,
    number: row.number,
    effectiveFrom,
    status: versionStatus(
      { effectiveFrom, id: row.id },
      dated.map((d) => ({ effectiveFrom: d.effectiveFrom, id: d.v.id })),
      today,
    ),
    inputs: inputs.map(lineView),
    outputs: outputs.map((line, index) => ({
      ...lineView(line),
      allocationRatio: line.allocationRatio ?? '0.00',
      yieldPercent: yieldPercent({
        inputWeight: figures.inputWeight,
        outputWeight: figures.outputWeights[index],
      }),
    })),
    ratiosOverridden: row.ratiosOverridden,
    inputWeightKg: formatKg(figures.inputWeight),
    outputWeightKg: formatKg(figures.outputWeight),
    wasteKg: formatKg(figures.waste),
    yieldPercent: yieldPercent(figures),
  };
}

function forOrder(
  bom: BomRow,
  row: VersionRow,
  items: ReadonlyMap<string, ItemFacts>,
): BomVersionForOrder {
  const lines = storedLines(row);
  const inputs = lines.filter((l) => l.side === BomSide.input);
  const outputs = lines.filter((l) => l.side === BomSide.output);
  const figures = bomFigures(inputs, outputs, items);
  return {
    bom: { id: bom.id, code: bom.code, nameTh: bom.nameTh, nameEn: bom.nameEn, active: bom.active },
    locationType: bom.locationType as BomLocationType,
    version: { id: row.id, number: row.number, effectiveFrom: dateText(row.effectiveFrom) },
    inputs: inputs.map((l) => ({
      lineNo: l.lineNo,
      itemId: l.itemId,
      quantity: l.quantity,
      expectedWeightKg: l.expectedWeightKg,
    })),
    outputs: outputs.map((l) => ({
      lineNo: l.lineNo,
      itemId: l.itemId,
      quantity: l.quantity,
      expectedWeightKg: l.expectedWeightKg,
      allocationRatio: l.allocationRatio ?? '0.00',
    })),
    expected: { inputWeightKg: figures.inputWeight, outputWeightsKg: figures.outputWeights },
  };
}

function header(row: BomRow) {
  return {
    id: row.id,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    locationType: row.locationType as BomLocationType,
    active: row.active,
    revision: row.revision,
  };
}

function itemIdsOf(versions: readonly VersionRow[]): string[] {
  return versions.flatMap((v) => v.lines.map((l) => l.itemId));
}

function linesSnapshot(lines: readonly StoredLine[], items: ReadonlyMap<string, ItemFacts>) {
  return lines.map((line) => {
    const item = items.get(line.itemId)!;
    return {
      side: line.side,
      itemCode: item.code,
      quantity: line.quantity,
      unitCode: item.baseUnitCode,
      ...(line.expectedWeightKg ? { expectedWeightKg: line.expectedWeightKg } : {}),
      ...(line.allocationRatio ? { allocationRatio: line.allocationRatio } : {}),
    };
  });
}

/**
 * The version as an auditor needs it. Codes are spelled `bomCode` and `itemCode` because the
 * audit trail redacts any field called `code`.
 */
function snapshot(row: VersionRow, items: ReadonlyMap<string, ItemFacts>) {
  return {
    id: row.id,
    number: row.number,
    effectiveFrom: dateText(row.effectiveFrom),
    ratiosOverridden: row.ratiosOverridden,
    lines: linesSnapshot(storedLines(row), items),
  };
}

function dateValue(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateText(value: Date): string {
  return value.toISOString().slice(0, 10);
}
