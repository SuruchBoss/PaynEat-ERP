// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { parseDecimal, type ExactDecimal } from '../../../core/quantity/domain/exact-decimal';
import {
  allocationRatios,
  bomFigures,
  bomIssues,
  defaultRatios,
  formatKg,
  yieldPercent,
  type BomItemFacts,
  type BomLineInput,
  type BomOutputInput,
} from './bom-rules';

const kg = (code: string): [string, BomItemFacts] => [
  code,
  { active: true, baseUnitCode: 'kg', baseUnitDecimals: 3 },
];
const piece = (code: string): [string, BomItemFacts] => [
  code,
  { active: true, baseUnitCode: 'piece', baseUnitDecimals: 0 },
];
const items = new Map<string, BomItemFacts>([
  kg('WHOLE-CHICKEN'),
  piece('BREAST'),
  piece('THIGH'),
  piece('DRUMSTICK'),
  piece('WING'),
  kg('CHICKEN-FRAME'),
  ['SALT', { active: true, baseUnitCode: 'g', baseUnitDecimals: 0 }],
  ['OLD', { active: false, baseUnitCode: 'kg', baseUnitDecimals: 3 }],
]);

/** The worked example: one case of whole chicken cut into pieces and frames. */
const cutting: { inputs: BomLineInput[]; outputs: BomOutputInput[] } = {
  inputs: [{ itemId: 'WHOLE-CHICKEN', quantity: '20.000' }],
  outputs: [
    { itemId: 'BREAST', quantity: '22', expectedWeightKg: '5.000' },
    { itemId: 'THIGH', quantity: '22', expectedWeightKg: '3.600' },
    { itemId: 'DRUMSTICK', quantity: '22', expectedWeightKg: '2.800' },
    { itemId: 'WING', quantity: '22', expectedWeightKg: '2.200' },
    { itemId: 'CHICKEN-FRAME', quantity: '4.4' },
  ],
};

const d = (text: string): ExactDecimal => {
  const value = parseDecimal(text);
  if (!value) throw new Error(text);
  return value;
};

describe('production BOM rules', () => {
  it('works through the whole-chicken cutting example', () => {
    expect(bomIssues(cutting.inputs, cutting.outputs, items)).toEqual({ lines: [], problems: [] });
    const figures = bomFigures(cutting.inputs, cutting.outputs, items);
    expect(formatKg(figures.inputWeight)).toBe('20.000');
    expect(formatKg(figures.outputWeight)).toBe('18.000');
    expect(formatKg(figures.waste)).toBe('2.000');
    expect(yieldPercent(figures)).toBe('90.00');
    expect(allocationRatios(cutting.outputs, figures.outputWeights)).toEqual({
      ratios: ['27.78', '20.00', '15.56', '12.22', '24.44'],
      overridden: false,
    });
  });

  it('keeps an overriding set of ratios that adds up to 100', () => {
    const ratios = ['35', '22', '18', '17', '8'];
    const outputs = cutting.outputs.map((line, i) => ({ ...line, allocationRatio: ratios[i] }));
    expect(bomIssues(cutting.inputs, outputs, items)).toEqual({ lines: [], problems: [] });
    const figures = bomFigures(cutting.inputs, outputs, items);
    expect(allocationRatios(outputs, figures.outputWeights)).toEqual({
      ratios: ['35.00', '22.00', '18.00', '17.00', '8.00'],
      overridden: true,
    });
  });

  it('refuses ratios that do not add up to exactly 100.00, or cover only some outputs', () => {
    const off = cutting.outputs.map((line, i) => ({
      ...line,
      allocationRatio: ['35', '22', '18', '17', '7.99'][i],
    }));
    expect(bomIssues(cutting.inputs, off, items).problems).toEqual(['ratios_not_100']);

    const some = cutting.outputs.map((line, i) => ({
      ...line,
      allocationRatio: i === 0 ? '50' : null,
    }));
    expect(bomIssues(cutting.inputs, some, items).problems).toEqual(['ratios_incomplete']);
  });

  it('refuses a ratio that is not a positive percentage to 0.01', () => {
    for (const ratio of ['0', '-5', '12.345', 'abc', '100.01']) {
      const outputs = cutting.outputs.map((line, i) => ({
        ...line,
        allocationRatio: i === 0 ? ratio : '10',
      }));
      expect(bomIssues(cutting.inputs, outputs, items).lines).toEqual([
        { side: 'output', lineNo: 1, problem: 'ratio_invalid' },
      ]);
    }
  });

  it('splits the hundredths a cut loses by largest remainder, ties to the earlier line', () => {
    expect(defaultRatios([d('1'), d('1'), d('1')])).toEqual(['33.34', '33.33', '33.33']);
    expect(defaultRatios([d('2'), d('1')])).toEqual(['66.67', '33.33']);
    expect(defaultRatios([d('7')])).toEqual(['100.00']);
    for (const weights of [
      ['1', '1', '1', '1', '1', '1', '1'],
      ['0.001', '999.999'],
      ['5', '3.6', '2.8', '2.2', '4.4'],
    ]) {
      const total = defaultRatios(weights.map(d)).reduce(
        (sum, r) => sum + Math.round(Number(r) * 100),
        0,
      );
      expect(total).toBe(10_000);
    }
  });

  it('weighs g items as a thousandth of their quantity', () => {
    const inputs = [
      { itemId: 'WHOLE-CHICKEN', quantity: '1' },
      { itemId: 'SALT', quantity: '250' },
    ];
    const outputs = [{ itemId: 'CHICKEN-FRAME', quantity: '1.25' }];
    expect(bomIssues(inputs, outputs, items)).toEqual({ lines: [], problems: [] });
    const figures = bomFigures(inputs, outputs, items);
    expect(formatKg(figures.inputWeight)).toBe('1.250');
    expect(formatKg(figures.waste)).toBe('0.000');
    expect(yieldPercent(figures)).toBe('100.00');
  });

  it('refuses outputs heavier than the inputs', () => {
    const outputs = [{ itemId: 'CHICKEN-FRAME', quantity: '20.001' }];
    expect(bomIssues(cutting.inputs, outputs, items).problems).toEqual([
      'outputs_heavier_than_inputs',
    ]);
  });

  it('asks for a weight where the unit is not one, and refuses one where it is', () => {
    const outputs: BomOutputInput[] = [
      { itemId: 'BREAST', quantity: '22' },
      { itemId: 'CHICKEN-FRAME', quantity: '4.4', expectedWeightKg: '4.4' },
      { itemId: 'WING', quantity: '22', expectedWeightKg: '0' },
      { itemId: 'THIGH', quantity: '22', expectedWeightKg: '1.2345' },
    ];
    expect(bomIssues(cutting.inputs, outputs, items).lines).toEqual([
      { side: 'output', lineNo: 1, problem: 'weight_missing' },
      { side: 'output', lineNo: 2, problem: 'weight_not_needed' },
      { side: 'output', lineNo: 3, problem: 'weight_invalid' },
      { side: 'output', lineNo: 4, problem: 'weight_invalid' },
    ]);
  });

  it('finds one problem per line, on the side it is on', () => {
    const inputs: BomLineInput[] = [
      { itemId: 'WHOLE-CHICKEN', quantity: '20' },
      { itemId: 'WHOLE-CHICKEN', quantity: '1' },
      { itemId: 'NOPE', quantity: '1' },
      { itemId: 'OLD', quantity: '1' },
      { itemId: 'SALT', quantity: '1.5' },
    ];
    const outputs: BomOutputInput[] = [
      { itemId: 'WHOLE-CHICKEN', quantity: '1' },
      { itemId: 'CHICKEN-FRAME', quantity: '0' },
      { itemId: 'BREAST', quantity: 'two', expectedWeightKg: '1' },
      { itemId: 'WING', quantity: '1234567890123', expectedWeightKg: '1' },
    ];
    expect(bomIssues(inputs, outputs, items).lines).toEqual([
      { side: 'input', lineNo: 2, problem: 'duplicate_item' },
      { side: 'input', lineNo: 3, problem: 'unknown_item' },
      { side: 'input', lineNo: 4, problem: 'inactive_item' },
      { side: 'input', lineNo: 5, problem: 'too_many_decimals' },
      { side: 'output', lineNo: 1, problem: 'on_both_sides' },
      { side: 'output', lineNo: 2, problem: 'not_positive' },
      { side: 'output', lineNo: 3, problem: 'not_a_decimal' },
      { side: 'output', lineNo: 4, problem: 'too_large' },
    ]);
  });

  it('needs at least one input and one output', () => {
    expect(bomIssues([], [], items).problems).toEqual(['no_inputs', 'no_outputs']);
  });
});
