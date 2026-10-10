// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  add,
  formatMinimal,
  multiply,
  negate,
  parseDecimal,
  sign,
  ZERO,
  type ExactDecimal,
} from '../../../core/quantity/domain/exact-decimal';
import {
  actualProblem,
  allocateCost,
  measuredWeightKg,
  outputExpiry,
  plannedLines,
  plannedQuantityProblem,
  productionYield,
  type OrderItemFacts,
} from './production-rules';

const d = (text: string): ExactDecimal => parseDecimal(text)!;

const KG: OrderItemFacts = { baseUnitCode: 'kg', baseUnitDecimals: 3, variableWeight: true };
const FLOUR: OrderItemFacts = { baseUnitCode: 'kg', baseUnitDecimals: 3, variableWeight: false };
const PIECE: OrderItemFacts = { baseUnitCode: 'piece', baseUnitDecimals: 0, variableWeight: false };

const items = new Map<string, OrderItemFacts>([
  ['chicken', KG],
  ['breast', PIECE],
  ['frame', KG],
  ['flour', FLOUR],
  ['seasoning', FLOUR],
]);

// The demo's whole-chicken cut (#12): 20 kg gives 22 breasts (5 kg) … and 4.4 kg of frames.
const RATIOS = ['35.00', '22.00', '18.00', '17.00', '8.00'];

describe('planning an order from its BOM version', () => {
  it('scales every line so the first input is the planned quantity, rounded to each unit', () => {
    const plan = plannedLines(
      [{ itemId: 'chicken', quantity: '20', expectedWeightKg: null }],
      [
        { itemId: 'breast', quantity: '22', expectedWeightKg: '5' },
        { itemId: 'frame', quantity: '4.4', expectedWeightKg: null },
      ],
      '238.4',
      items,
    );
    expect(plan.inputs).toEqual([{ itemId: 'chicken', quantity: '238.4' }]);
    // 22 × 238.4 ÷ 20 = 262.24 breasts, planned as 262; 4.4 × 11.92 = 52.448 kg of frames.
    expect(plan.outputs).toEqual([
      { itemId: 'breast', quantity: '262' },
      { itemId: 'frame', quantity: '52.448' },
    ]);
  });

  it('scales the other inputs with the first', () => {
    const plan = plannedLines(
      [
        { itemId: 'flour', quantity: '25', expectedWeightKg: null },
        { itemId: 'seasoning', quantity: '1', expectedWeightKg: null },
      ],
      [{ itemId: 'flour', quantity: '25.8', expectedWeightKg: null }],
      '40',
      items,
    );
    expect(plan.inputs.map((l) => l.quantity)).toEqual(['40', '1.6']);
    expect(plan.outputs.map((l) => l.quantity)).toEqual(['41.28']);
  });

  it('refuses a planned quantity the item cannot hold', () => {
    expect(plannedQuantityProblem('500', KG)).toBeNull();
    expect(plannedQuantityProblem('0', KG)).toBe('not_positive');
    expect(plannedQuantityProblem('-1', KG)).toBe('not_positive');
    expect(plannedQuantityProblem('1.2345', KG)).toBe('too_many_decimals');
    expect(plannedQuantityProblem('2.5', PIECE)).toBe('too_many_decimals');
    expect(plannedQuantityProblem('five', KG)).toBe('not_a_decimal');
  });
});

describe('recorded actuals', () => {
  it('accepts zero, which only posting refuses', () => {
    expect(actualProblem({ quantity: '0', pieces: null, weightKg: '0' }, PIECE)).toBeNull();
  });

  it('takes a piece count only on variable-weight items and a weight only where it is needed', () => {
    expect(actualProblem({ quantity: '52.1', pieces: '119', weightKg: null }, KG)).toBeNull();
    expect(actualProblem({ quantity: '40', pieces: '3', weightKg: null }, FLOUR)).toBe(
      'pieces_not_allowed',
    );
    expect(actualProblem({ quantity: '1', pieces: '1.5', weightKg: null }, KG)).toBe(
      'pieces_invalid',
    );
    expect(actualProblem({ quantity: '1', pieces: null, weightKg: '1' }, KG)).toBe(
      'weight_not_needed',
    );
    expect(actualProblem({ quantity: '250', pieces: null, weightKg: '-1' }, PIECE)).toBe(
      'weight_invalid',
    );
    expect(actualProblem({ quantity: '2.5', pieces: null, weightKg: null }, PIECE)).toBe(
      'too_many_decimals',
    );
    expect(actualProblem({ quantity: '-1', pieces: null, weightKg: null }, KG)).toBe('negative');
  });

  it('weighs kg and g items by their quantity and others only by a measured weight', () => {
    expect(measuredWeightKg('52.1', null, KG)).toEqual(d('52.1'));
    expect(formatMinimal(measuredWeightKg('500', null, { baseUnitCode: 'g' })!)).toBe('0.5');
    expect(measuredWeightKg('250', '56.4', PIECE)).toEqual(d('56.4'));
    expect(measuredWeightKg('250', null, PIECE)).toBeNull();
  });
});

describe('yield against the BOM', () => {
  const expected = {
    inputWeightKg: d('20'),
    outputWeightsKg: [d('5'), d('3.6'), d('2.8'), d('2.2'), d('4.4')],
  };

  it('shows actual yield per output and overall, and the difference from expected', () => {
    const result = productionYield({
      inputWeightKg: d('238.4'),
      outputWeightsKg: [d('56.4'), d('41.2'), d('32.6'), d('25.3'), d('51.0')],
      expected,
    });
    // Expected 18 kg of 20 is 90.00 %; 206.5 of 238.4 is 86.62 %.
    expect(result.overall).toEqual({ expected: '90.00', actual: '86.62', difference: '-3.38' });
    expect(result.outputs[0]).toEqual({ expected: '25.00', actual: '23.66', difference: '-1.34' });
    expect(result.outputs[4]).toEqual({ expected: '22.00', actual: '21.39', difference: '-0.61' });
  });

  it('leaves the actual empty until the weights are measured', () => {
    const result = productionYield({
      inputWeightKg: d('238.4'),
      outputWeightsKg: [d('56.4'), null, d('32.6'), d('25.3'), d('51.0')],
      expected,
    });
    expect(result.overall).toEqual({ expected: '90.00', actual: null, difference: null });
    expect(result.outputs[1].actual).toBeNull();
    expect(result.outputs[0].actual).toBe('23.66');
    expect(
      productionYield({ inputWeightKg: null, outputWeightsKg: [d('1')], expected }).overall.actual,
    ).toBeNull();
  });
});

describe('cost allocation', () => {
  // 238.4 kg of whole chicken at 64.2 a kg: 15,305.28.
  const consumed = [{ quantity: '238.4', unitCost: '64.2' }];

  it('splits the input value by ratio and divides it by each actual quantity', () => {
    const result = allocateCost(
      consumed,
      RATIOS.map((ratio, i) => ({ ratio, quantity: ['262', '262', '262', '262', '52.448'][i] })),
    );
    if (!result.ok) throw new Error('refused');
    expect(result.inputValue).toBe('15305.28');
    // Breast: 35 % of 15,305.28 = 5,356.848 over 262 pieces = 20.4459847… a piece.
    expect(result.outputs[0]).toEqual({
      allocatedValue: '5356.848',
      unitCost: '20.445985',
      lotValue: '5356.84807',
      roundingDifference: '-0.00007',
    });
    // Frame: 8 % = 1,224.4224 over 52.448 kg.
    expect(result.outputs[4].unitCost).toBe('23.345455');
    expectBalanced(result.inputValue, result.outputs);
  });

  it('raises the unit cost when the yield is poor: waste carries no cost', () => {
    const good = allocateCost(consumed, [
      { ratio: '92.00', quantity: '200' },
      { ratio: '8.00', quantity: '52' },
    ]);
    const poor = allocateCost(consumed, [
      { ratio: '92.00', quantity: '170' },
      { ratio: '8.00', quantity: '44' },
    ]);
    if (!good.ok || !poor.ok) throw new Error('refused');
    expect(poor.inputValue).toBe(good.inputValue);
    expect(Number(poor.outputs[0].unitCost)).toBeGreaterThan(Number(good.outputs[0].unitCost));
    expect(Number(poor.outputs[1].unitCost)).toBeGreaterThan(Number(good.outputs[1].unitCost));
    expect(good.outputs[0].unitCost).toBe('70.404288');
    expect(poor.outputs[0].unitCost).toBe('82.828574');
  });

  it('refuses an output with no actual quantity rather than dividing by zero', () => {
    expect(
      allocateCost(consumed, [
        { ratio: '60.00', quantity: '100' },
        { ratio: '40.00', quantity: '0' },
      ]),
    ).toEqual({ ok: false, problem: 'zero_output_quantity', outputIndex: 1 });
  });

  it('refuses ratios that do not add up to 100', () => {
    expect(() => allocateCost(consumed, [{ ratio: '99.99', quantity: '1' }])).toThrow(RangeError);
  });

  it('rounds the unit cost half up to six decimals and keeps what moved', () => {
    // 1,000 over 22 = 45.4545… → 45.454545, lot value 999.99999, difference 0.00001.
    const result = allocateCost(
      [{ quantity: '1', unitCost: '1000' }],
      [{ ratio: '100.00', quantity: '22' }],
    );
    if (!result.ok) throw new Error('refused');
    expect(result.outputs[0]).toEqual({
      allocatedValue: '1000',
      unitCost: '45.454545',
      lotValue: '999.99999',
      roundingDifference: '0.00001',
    });
    // 2 over 3 = 0.6666666… → 0.666667, half up.
    const up = allocateCost([{ quantity: '2', unitCost: '1' }], [{ ratio: '100', quantity: '3' }]);
    if (!up.ok) throw new Error('refused');
    expect(up.outputs[0].unitCost).toBe('0.666667');
    expect(up.outputs[0].roundingDifference).toBe('-0.000001');
  });

  it('never loses or invents value, whatever the quantities and costs (seeded, 500 orders)', () => {
    const random = seeded(13);
    for (let order = 0; order < 500; order += 1) {
      const lots = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
        quantity: decimalText(random, 1, 9999, 3),
        unitCost: decimalText(random, 0, 999, 6),
      }));
      const count = 1 + Math.floor(random() * 6);
      const ratios = ratiosAddingTo100(random, count);
      const outputs = ratios.map((ratio) => ({
        ratio,
        quantity: decimalText(random, 1, 999, random() < 0.5 ? 0 : 3),
      }));
      const result = allocateCost(lots, outputs);
      if (!result.ok) throw new Error('refused');
      expectBalanced(result.inputValue, result.outputs, outputs);
    }
  });
});

describe('output lot expiry (ADR-0014)', () => {
  it('is the production date plus shelf life', () => {
    expect(outputExpiry('2026-10-10', 4, ['2026-10-16', '2026-10-15'])).toEqual({
      expiryDate: '2026-10-14',
      computedExpiryDate: '2026-10-14',
      earliestInputExpiryDate: '2026-10-15',
    });
  });

  it('is never later than the earliest input lot it consumed', () => {
    expect(outputExpiry('2026-10-10', 4, ['2026-10-16', '2026-10-12'])).toEqual({
      expiryDate: '2026-10-12',
      computedExpiryDate: '2026-10-14',
      earliestInputExpiryDate: '2026-10-12',
    });
    expect(outputExpiry('2026-10-10', 90, ['2026-10-10']).expiryDate).toBe('2026-10-10');
  });
});

/**
 * ADR-0027: Σ lot values + Σ rounding differences = input value exactly, and every difference is
 * within half a unit of the unit cost's last decimal, per unit of output.
 */
function expectBalanced(
  inputValue: string,
  outputs: ReadonlyArray<{ lotValue: string; roundingDifference: string; unitCost: string }>,
  quantities?: ReadonlyArray<{ quantity: string }>,
): void {
  const total = outputs.reduce(
    (sum, o) => add(add(sum, d(o.lotValue)), d(o.roundingDifference)),
    ZERO,
  );
  expect(sign(add(total, negate(d(inputValue))))).toBe(0);
  outputs.forEach((o, i) => {
    expect(o.unitCost).toMatch(/^\d+\.\d{6}$/);
    if (!quantities) return;
    const bound = multiply(d(quantities[i].quantity), d('0.0000005'));
    const difference = d(o.roundingDifference);
    const magnitude = sign(difference) < 0 ? negate(difference) : difference;
    expect(sign(add(bound, negate(magnitude)))).toBeGreaterThanOrEqual(0);
  });
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function decimalText(random: () => number, min: number, max: number, places: number): string {
  const whole = min + Math.floor(random() * (max - min + 1));
  if (places === 0) return String(whole);
  const fraction = String(Math.floor(random() * 10 ** places)).padStart(places, '0');
  return `${whole}.${fraction}`;
}

/** `count` ratios of at least 0.01 %, two decimals, adding up to exactly 100.00. */
function ratiosAddingTo100(random: () => number, count: number): string[] {
  let left = 10_000;
  const hundredths: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const share = 1 + Math.floor(random() * (left - (count - i)));
    hundredths.push(share);
    left -= share;
  }
  hundredths.push(left);
  return hundredths.map((h) => (h / 100).toFixed(2));
}
