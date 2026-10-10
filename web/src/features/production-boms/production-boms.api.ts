// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Production BOMs (backend `modules/production-boms/production-boms.controller.ts`, #12).
import { api } from '@/lib/api-client';

export type BomTiming = 'current' | 'scheduled' | 'past';
export type BomSide = 'input' | 'output';

export interface BomItemRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
}

export interface BomLineView {
  lineNo: number;
  item: BomItemRef;
  quantity: string;
  expectedWeightKg: string | null;
  weightKg: string;
}

export interface BomOutputView extends BomLineView {
  allocationRatio: string;
  yieldPercent: string;
}

export interface BomVersionView {
  id: string;
  number: number;
  effectiveFrom: string;
  status: BomTiming;
  inputs: BomLineView[];
  outputs: BomOutputView[];
  ratiosOverridden: boolean;
  inputWeightKg: string;
  outputWeightKg: string;
  wasteKg: string;
  yieldPercent: string;
}

export interface ProductionBomSummary {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  locationType: 'plant';
  active: boolean;
  revision: number;
  current: { number: number; effectiveFrom: string; yieldPercent: string } | null;
  scheduled: { number: number; effectiveFrom: string } | null;
}

export interface ProductionBomView extends Omit<ProductionBomSummary, 'current' | 'scheduled'> {
  today: string;
  versions: BomVersionView[];
}

export interface BomInputLine {
  itemId: string;
  quantity: string;
  expectedWeightKg?: string | null;
}

export interface BomOutputLine extends BomInputLine {
  allocationRatio?: string | null;
}

export interface BomLines {
  inputs: BomInputLine[];
  outputs: BomOutputLine[];
}

export interface NewBomVersion extends BomLines {
  effectiveFrom: string;
}

export interface NewProductionBom extends NewBomVersion {
  code: string;
  nameTh: string;
  nameEn: string;
  locationType: 'plant';
}

export interface BomChange {
  revision: number;
  nameTh?: string;
  nameEn?: string;
  active?: boolean;
}

export interface BomLineIssue {
  side: BomSide;
  lineNo: number;
  problem: string;
}

export interface BomPreview {
  issues: BomLineIssue[];
  problems: string[];
  figures: {
    inputWeightKg: string;
    outputWeightKg: string;
    wasteKg: string;
    yieldPercent: string;
    outputs: Array<{ weightKg: string; yieldPercent: string; defaultRatio: string }>;
  } | null;
  statedRatioTotal: string | null;
}

export const listProductionBoms = (includeInactive: boolean) =>
  api.get<ProductionBomSummary[]>(
    `/production-boms${includeInactive ? '?includeInactive=true' : ''}`,
  );

export const getProductionBom = (id: string) =>
  api.get<ProductionBomView>(`/production-boms/${encodeURIComponent(id)}`);

export const createProductionBom = (bom: NewProductionBom) =>
  api.post<ProductionBomView>('/production-boms', bom);

export const updateProductionBom = (id: string, change: BomChange) =>
  api.patch<ProductionBomView>(`/production-boms/${encodeURIComponent(id)}`, change);

export const addBomVersion = (id: string, version: NewBomVersion) =>
  api.post<ProductionBomView>(`/production-boms/${encodeURIComponent(id)}/versions`, version);

export const correctBomVersion = (versionId: string, lines: BomLines) =>
  api.put<ProductionBomView>(`/production-boms/versions/${encodeURIComponent(versionId)}`, lines);

export const previewBom = (lines: BomLines) =>
  api.post<BomPreview>('/production-boms/preview', lines);

/** Units whose quantity is itself a weight: their lines state no expected weight (ADR-0026). */
export const WEIGHT_UNITS: readonly string[] = ['kg', 'g'];
