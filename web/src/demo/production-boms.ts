// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Production BOMs in the demo (#12, ADR-0021), read only: the backend's demo BOMs with dates
 * counted from today as the seed counts them, weights, yields and allocation ratios worked out
 * by the backend's own `bom-rules`, and the live preview a person sees while entering a version.
 * Creating or changing a BOM answers NOT_IN_DEMO, as ADR-0021 allows.
 */
import { addDays, dateIn } from '@backend/src/core/time/domain/business-date';
import { versionInEffect, versionStatus } from '@backend/src/core/time/domain/dated-versions';
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
  type BomItemFacts,
  type BomOutputInput,
} from '@backend/src/modules/production-boms/domain/bom-rules';
import { DEMO_PRODUCTION_BOMS } from '@backend/prisma/demo-data';
import { notFound, refused, uuidParam, type Context } from './http';
import { UNITS } from './seed';
import { DEMO_TIME_ZONE, seedId, type DemoState } from './state';

const KIND = { bom: 13, version: 14 };

const dayOf = (now: number) => dateIn(DEMO_TIME_ZONE, new Date(now));

function facts(state: DemoState): Map<string, BomItemFacts> {
  const decimals = new Map<string, number>(UNITS.map((u) => [u.code, u.decimals]));
  return new Map(
    state.items.map((item) => [
      item.id,
      {
        active: item.active,
        baseUnitCode: item.baseUnitCode,
        baseUnitDecimals: decimals.get(item.baseUnitCode) ?? 0,
      },
    ]),
  );
}

/** The demo's BOMs as the API shows them, each with its one version. */
function boms(state: DemoState, now: number) {
  const today = dayOf(now);
  const itemFacts = facts(state);
  const byCode = new Map(state.items.map((i) => [i.code, i]));
  return DEMO_PRODUCTION_BOMS.map((demo, index) => {
    const line = (l: (typeof demo.inputs)[number]): BomOutputInput => ({
      itemId: byCode.get(l.itemCode)!.id,
      quantity: l.quantity,
      expectedWeightKg: l.expectedWeightKg ?? null,
      allocationRatio: l.allocationRatio ?? null,
    });
    const inputs = demo.inputs.map(line);
    const outputs = demo.outputs.map(line);
    const figures = bomFigures(inputs, outputs, itemFacts);
    const ratios = allocationRatios(outputs, figures.outputWeights);
    const effectiveFrom = addDays(today, demo.fromDay);
    const dated = [{ effectiveFrom }];
    const lineView = (l: BomOutputInput, lineNo: number) => {
      const item = state.items.find((i) => i.id === l.itemId)!;
      const weight = lineWeightKg(l, itemFacts.get(item.id)!);
      return {
        lineNo,
        item: {
          id: item.id,
          code: item.code,
          nameTh: item.nameTh,
          nameEn: item.nameEn,
          baseUnitCode: item.baseUnitCode,
        },
        quantity: normaliseQuantity(l.quantity),
        expectedWeightKg: l.expectedWeightKg ? formatKg(weight) : null,
        weightKg: formatKg(weight),
      };
    };
    const version = {
      id: seedId(KIND.version, index),
      number: 1,
      effectiveFrom,
      status: versionStatus({ effectiveFrom }, dated, today),
      inputs: inputs.map((l, i) => lineView(l, i + 1)),
      outputs: outputs.map((l, i) => ({
        ...lineView(l, i + 1),
        allocationRatio: ratios.ratios[i],
        yieldPercent: yieldPercent({
          inputWeight: figures.inputWeight,
          outputWeight: figures.outputWeights[i],
        }),
      })),
      ratiosOverridden: ratios.overridden,
      inputWeightKg: formatKg(figures.inputWeight),
      outputWeightKg: formatKg(figures.outputWeight),
      wasteKg: formatKg(figures.waste),
      yieldPercent: yieldPercent(figures),
    };
    return {
      id: seedId(KIND.bom, index),
      code: demo.code,
      nameTh: demo.nameTh,
      nameEn: demo.nameEn,
      locationType: 'plant' as const,
      active: true,
      revision: 1,
      versions: [version],
      inForce: versionInEffect(dated, today) !== null,
    };
  });
}

export function listProductionBoms(state: DemoState, ctx: Context) {
  return boms(state, ctx.now).map(({ versions, inForce, ...bom }) => ({
    ...bom,
    current: inForce
      ? {
          number: versions[0].number,
          effectiveFrom: versions[0].effectiveFrom,
          yieldPercent: versions[0].yieldPercent,
        }
      : null,
    scheduled: inForce
      ? null
      : { number: versions[0].number, effectiveFrom: versions[0].effectiveFrom },
  }));
}

export function getProductionBom(state: DemoState, ctx: Context) {
  const id = uuidParam(ctx.params[0]);
  const found = boms(state, ctx.now).find((b) => b.id === id);
  if (!found) throw notFound('ProductionBom', id);
  const { inForce: _inForce, ...bom } = found;
  return { ...bom, today: dayOf(ctx.now) };
}

interface PreviewBody {
  inputs: BomOutputInput[];
  outputs: BomOutputInput[];
}

function isLines(value: unknown): value is BomOutputInput[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (l) =>
        typeof l === 'object' &&
        l !== null &&
        typeof (l as BomOutputInput).itemId === 'string' &&
        typeof (l as BomOutputInput).quantity === 'string',
    )
  );
}

/** What the backend's preview answers, worked out by the same rules. */
export function previewProductionBom(state: DemoState, ctx: Context) {
  const body = ctx.body as Partial<PreviewBody> | undefined;
  if (!body || !isLines(body.inputs) || !isLines(body.outputs)) {
    throw refused('VALIDATION_FAILED', 'inputs and outputs need at least one line each');
  }
  const itemFacts = facts(state);
  const { lines: issues, problems } = bomIssues(body.inputs, body.outputs, itemFacts);
  const stated = statedRatioTotal(body.outputs);
  if (issues.length > 0) return { issues, problems, figures: null, statedRatioTotal: stated };
  const figures = bomFigures(body.inputs, body.outputs, itemFacts);
  const defaults = defaultRatios(figures.outputWeights);
  return {
    issues,
    problems,
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
