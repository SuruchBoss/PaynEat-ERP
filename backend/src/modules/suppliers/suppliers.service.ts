// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { AuditService } from '../audit/audit.service';
import { normaliseTaxId, thaiTaxIdProblem } from './domain/thai-tax-id';
import type {
  CreateSupplierDto,
  SupplierView,
  SuppliersQueryDto,
  UpdateSupplierDto,
} from './dto/suppliers.dto';

const SUPPLIER_SELECT = {
  id: true,
  code: true,
  name: true,
  taxId: true,
  contactName: true,
  phone: true,
  email: true,
  address: true,
  active: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierSelect;

type SupplierRow = Prisma.SupplierGetPayload<{ select: typeof SUPPLIER_SELECT }>;

const EDITABLE = ['name', 'taxId', 'contactName', 'phone', 'email', 'address', 'active'] as const;
type Editable = (typeof EDITABLE)[number];

/**
 * The companies the chain buys from (#6). `admin` and `purchasing` manage them. They stay
 * inside the ERP (ADR-0002): no master data version, nothing a POS pulls. Deactivated,
 * never deleted; every change audited.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SuppliersQueryDto): Promise<SupplierView[]> {
    const rows = await this.prisma.supplier.findMany({
      where: query.status === 'all' ? {} : { active: query.status === 'active' },
      select: SUPPLIER_SELECT,
      orderBy: { code: 'asc' },
    });
    return rows;
  }

  async get(id: string): Promise<SupplierView> {
    const row = await this.prisma.supplier.findUnique({ where: { id }, select: SUPPLIER_SELECT });
    if (!row) throw new NotFoundError('Supplier', id);
    return row;
  }

  async create(
    dto: CreateSupplierDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<SupplierView> {
    const taxId = validTaxId(dto.taxId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.supplier.create({
          data: {
            code: dto.code,
            name: dto.name,
            taxId,
            contactName: dto.contactName ?? null,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            address: dto.address ?? null,
          },
          select: SUPPLIER_SELECT,
        });
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.CREATE,
          entityType: 'Supplier',
          entityId: created.id,
          summary: `Created supplier ${created.code} (${created.name})`,
          changes: snapshot(created),
          ...meta,
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          'SUPPLIER_CODE_TAKEN',
          `A supplier with code ${dto.code} already exists`,
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateSupplierDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<SupplierView> {
    const next: Partial<Record<Editable, unknown>> = {
      name: dto.name,
      taxId: dto.taxId === undefined ? undefined : validTaxId(dto.taxId),
      contactName: dto.contactName,
      phone: dto.phone,
      email: dto.email,
      address: dto.address,
      active: dto.active,
    };

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM suppliers WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundError('Supplier', id);
      const current = await tx.supplier.findUniqueOrThrow({
        where: { id },
        select: SUPPLIER_SELECT,
      });
      if (current.revision !== dto.revision) {
        throw new ConflictError(
          'SUPPLIER_CHANGED',
          'This supplier was changed by someone else since you opened it. Reload it and try again.',
          { currentRevision: current.revision },
        );
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of EDITABLE) {
        const to = next[field];
        if (to !== undefined && to !== current[field])
          changes[field] = { from: current[field], to };
      }
      if (Object.keys(changes).length === 0) return current;

      const data = Object.fromEntries(
        Object.entries(changes).map(([field, change]) => [field, change.to]),
      ) as Prisma.SupplierUpdateInput;
      const updated = await tx.supplier.update({
        where: { id },
        data: { ...data, revision: { increment: 1 } },
        select: SUPPLIER_SELECT,
      });
      const onlyActive = Object.keys(changes).length === 1 && changes.active;
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'Supplier',
        entityId: id,
        summary: onlyActive
          ? `${updated.active ? 'Reactivated' : 'Deactivated'} supplier ${updated.code}`
          : `Updated supplier ${updated.code} (${updated.name})`,
        changes,
        ...meta,
      });
      return updated;
    });
  }
}

function validTaxId(input: string): string {
  const taxId = normaliseTaxId(input);
  const problem = thaiTaxIdProblem(taxId);
  if (problem) {
    throw new BusinessRuleError(
      'INVALID_TAX_ID',
      problem === 'NOT_13_DIGITS'
        ? 'A Thai tax identification number has 13 digits'
        : 'This tax identification number fails its check digit; one of its digits is mistyped',
      { problem },
    );
  }
  return taxId;
}

/** `supplierCode`: the audit trail redacts any field called `code`. */
function snapshot(row: SupplierRow) {
  const { code, createdAt: _c, updatedAt: _u, revision: _r, ...rest } = row;
  return { supplierCode: code, ...rest };
}
