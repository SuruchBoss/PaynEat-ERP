// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Versioned recipes (#16, ADR-0002, ADR-0005, ADR-0023). A recipe version is in force from its
 * effective-from business date until the next version starts; there is no end date to
 * keep in step, so two versions of one recipe can never cover the same day unless they
 * start on it, and that is refused. No clock here: callers pass today's business date.
 */
import { addDays, compareDates } from '../../../core/time/domain/business-date';
import {
  add,
  decimalPlaces,
  formatMinimal,
  integerDigits,
  multiply,
  parseDecimal,
  sign,
  ZERO,
  type ExactDecimal,
} from '../../../core/quantity/domain/exact-decimal';

export interface Dated {
  /** ISO `YYYY-MM-DD`, a business date in the company's time zone (ADR-0018). */
  effectiveFrom: string;
}

/**
 * The version in force on `date`: the one with the latest effective-from on or before it.
 * Null when the first version starts later, or there is none. The input order does not
 * matter.
 */
export function recipeInEffect<T extends Dated>(versions: readonly T[], date: string): T | null {
  let found: T | null = null;
  for (const version of versions) {
    if (compareDates(version.effectiveFrom, date) > 0) continue;
    if (!found || compareDates(version.effectiveFrom, found.effectiveFrom) > 0) found = version;
  }
  return found;
}

/** Whether a version has taken effect: from then on it is history and never changes. */
export function hasTakenEffect(version: Dated, today: string): boolean {
  return compareDates(version.effectiveFrom, today) <= 0;
}

export type NewVersionProblem =
  /** Another version of this recipe starts on that day: two would be in force at once. */
  | { reason: 'overlap' }
  /**
   * Earlier than `earliest`. A version never starts in the past; once a version is in
   * force, a new one starts tomorrow at the earliest, so no day that has begun changes
   * recipe after sales may already have been made on it.
   */
  | { reason: 'too_early'; earliest: string };

/** Why a new version starting on `effectiveFrom` is refused, or null when it is allowed. */
export function newVersionProblem(
  existing: readonly Dated[],
  effectiveFrom: string,
  today: string,
): NewVersionProblem | null {
  const earliest = recipeInEffect(existing, today) ? addDays(today, 1) : today;
  if (compareDates(effectiveFrom, earliest) < 0) return { reason: 'too_early', earliest };
  if (existing.some((v) => v.effectiveFrom === effectiveFrom)) return { reason: 'overlap' };
  return null;
}

export interface PricePoint extends Dated {
  /** The branch's location code, or null for the price every branch uses by default. */
  locationCode: string | null;
}

/**
 * The price a branch charges on `date`: its own override in force then, else the
 * chain-wide price in force then. A branch override is never mixed with a later
 * chain-wide change: the branch's own price wins for as long as one is in force.
 */
export function priceInEffect<T extends PricePoint>(
  prices: readonly T[],
  locationCode: string | null,
  date: string,
): T | null {
  if (locationCode) {
    const own = recipeInEffect(
      prices.filter((p) => p.locationCode === locationCode),
      date,
    );
    if (own) return own;
  }
  return recipeInEffect(
    prices.filter((p) => p.locationCode === null),
    date,
  );
}

/** Which recipe a line belongs to: a menu item's, or a modifier option's (ADR-0023). */
export type RecipeKind = 'menu' | 'modifier';

export interface RecipeLineInput {
  itemId: string;
  /** In the item's base unit, as a decimal string (ADR-0019). */
  quantity: string;
}

export interface RecipeItemFacts {
  active: boolean;
  /** Decimals a quantity in the item's base unit keeps (ADR-0019). */
  baseUnitDecimals: number;
}

export type RecipeLineProblem =
  | 'unknown_item'
  | 'inactive_item'
  | 'duplicate_item'
  | 'not_a_decimal'
  /** A menu recipe consumes: every quantity is above zero. */
  | 'not_positive'
  /** A modifier recipe adds (above zero) or removes (below zero): never nothing. */
  | 'zero'
  | 'too_many_decimals'
  | 'too_large';

export interface RecipeLineIssue {
  /** 1-based, as the person counts lines. */
  lineNo: number;
  problem: RecipeLineProblem;
}

/** Twelve digits before the point: more than any real portion, less than NUMERIC(18,6) holds. */
const MAX_INTEGER_DIGITS = 12;

/**
 * Everything wrong with a recipe's lines, one issue per line at most. An empty list of
 * lines is the caller's problem to refuse; this only looks at the lines it gets.
 */
export function recipeLineIssues(
  kind: RecipeKind,
  lines: readonly RecipeLineInput[],
  items: ReadonlyMap<string, RecipeItemFacts>,
): RecipeLineIssue[] {
  const issues: RecipeLineIssue[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const problem = lineProblem(kind, line, items, seen);
    seen.add(line.itemId);
    if (problem) issues.push({ lineNo, problem });
  });
  return issues;
}

function lineProblem(
  kind: RecipeKind,
  line: RecipeLineInput,
  items: ReadonlyMap<string, RecipeItemFacts>,
  seen: ReadonlySet<string>,
): RecipeLineProblem | null {
  const item = items.get(line.itemId);
  if (!item) return 'unknown_item';
  if (!item.active) return 'inactive_item';
  if (seen.has(line.itemId)) return 'duplicate_item';
  const quantity = parseDecimal(line.quantity);
  if (!quantity) return 'not_a_decimal';
  if (kind === 'menu' && sign(quantity) <= 0) return 'not_positive';
  if (kind === 'modifier' && sign(quantity) === 0) return 'zero';
  if (decimalPlaces(quantity) > item.baseUnitDecimals) return 'too_many_decimals';
  if (integerDigits(quantity) > MAX_INTEGER_DIGITS) return 'too_large';
  return null;
}

/** A quantity or a price in its shortest exact spelling: "0.150" → "0.15". */
export function normalise(text: string): string {
  return formatMinimal(decimal(text));
}

export interface ModifierOnLine {
  /** The option recipe in force at the sale, per one unit sold of the line. */
  lines: readonly RecipeLineInput[];
  /** How many of the option each unit sold carries (sales event `modifiers[].quantity`). */
  quantity: string;
}

/**
 * Theoretical usage of one sale line (ADR-0002, contract 1.1): the menu recipe plus every
 * option recipe times its modifier quantity, all times the line's quantity (pieces) or
 * `weightKg` (weighed items). Usage = option recipe × modifier quantity × line quantity.
 * Items the modifiers cancel out (a total of zero) stay in the result, so a "no sauce"
 * option visibly takes the sauce to nothing rather than dropping the line.
 */
export function theoreticalUsage(
  menuRecipe: readonly RecipeLineInput[],
  modifiers: readonly ModifierOnLine[],
  lineQuantity: string,
): Map<string, string> {
  const perUnit = new Map<string, ExactDecimal>();
  const addTo = (itemId: string, amount: ExactDecimal) =>
    perUnit.set(itemId, add(perUnit.get(itemId) ?? ZERO, amount));
  for (const line of menuRecipe) addTo(line.itemId, decimal(line.quantity));
  for (const modifier of modifiers) {
    for (const line of modifier.lines) {
      addTo(line.itemId, multiply(decimal(line.quantity), decimal(modifier.quantity)));
    }
  }
  const sold = decimal(lineQuantity);
  return new Map(
    [...perUnit].map(([itemId, amount]) => [itemId, formatMinimal(multiply(amount, sold))]),
  );
}

export interface CostedLine {
  quantity: string;
  /** The item's current lot cost per base unit, or null when no lot has a cost to offer. */
  unitCost: string | null;
}

export interface RecipeCost {
  /** Per line, in input order; null where the item has no current lot cost. */
  lines: Array<string | null>;
  /** The sum of the lines that have a cost. */
  total: string;
  /** False when any line has no cost: the total is then a floor, not the cost. */
  complete: boolean;
}

/**
 * The theoretical ingredient cost of one portion (or one kilogram sold): each line's
 * quantity times its item's current lot cost, exact (ADR-0019). An estimate, and shown as
 * one: actual consumption takes the cost of the lot FEFO picks at the time (ADR-0004).
 */
export function recipeCost(lines: readonly CostedLine[]): RecipeCost {
  let total = ZERO;
  let complete = true;
  const costs = lines.map((line) => {
    if (line.unitCost === null) {
      complete = false;
      return null;
    }
    const cost = multiply(decimal(line.quantity), decimal(line.unitCost));
    total = add(total, cost);
    return formatMinimal(cost);
  });
  return { lines: costs, total: formatMinimal(total), complete };
}

export type MoneyProblem = 'not_a_decimal' | 'negative' | 'too_many_decimals' | 'too_large';

/**
 * A price in baht as the POS shows it (two decimals at most, satang). Menu prices are
 * zero or more; a modifier option's price change may be negative (`allowNegative`).
 */
export function moneyProblem(text: string, allowNegative: boolean): MoneyProblem | null {
  const value = parseDecimal(text);
  if (!value) return 'not_a_decimal';
  if (!allowNegative && sign(value) < 0) return 'negative';
  if (decimalPlaces(value) > 2) return 'too_many_decimals';
  if (integerDigits(value) > 8) return 'too_large';
  return null;
}

function decimal(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: "${text}"`);
  return value;
}
