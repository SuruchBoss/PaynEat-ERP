// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Suppliers (backend `modules/suppliers/suppliers.controller.ts`).
import { api } from '@/lib/api-client';

export interface SupplierView {
  id: string;
  code: string;
  name: string;
  /** 13 digits, stored without separators. */
  taxId: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierFields {
  name: string;
  taxId: string;
  /** Sent empty to clear. */
  contactName: string;
  phone: string;
  email: string;
  address: string;
}

export interface NewSupplier extends SupplierFields {
  code: string;
}

export type SupplierChange = Partial<SupplierFields> & { revision: number; active?: boolean };

/** Every supplier, active or not: the list filters on screen. */
export const listSuppliers = () =>
  api.get<SupplierView[]>('/suppliers', { query: { status: 'all' } });

export const createSupplier = (supplier: NewSupplier) =>
  api.post<SupplierView>('/suppliers', supplier);

export const updateSupplier = (id: string, change: SupplierChange) =>
  api.patch<SupplierView>(`/suppliers/${encodeURIComponent(id)}`, change);

/** 0105512345678 → 0-1055-12345-67-8, the way it is printed on Thai tax documents. */
export function formatTaxId(taxId: string): string {
  if (!/^\d{13}$/.test(taxId)) return taxId;
  return `${taxId[0]}-${taxId.slice(1, 5)}-${taxId.slice(5, 10)}-${taxId.slice(10, 12)}-${taxId[12]}`;
}
