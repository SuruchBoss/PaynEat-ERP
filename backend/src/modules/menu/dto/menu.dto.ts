// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** The ecosystem-wide code shape (docs/GLOSSARY.md, "Location code"), as sales events carry it. */
export const MENU_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
export const MODIFIER_GROUPS_MAX = 20;
export const MODIFIER_OPTIONS_MAX = 50;
export const RECIPE_LINES_MAX = 50;
export const SELECTIONS_MAX = 50;

const CODE_MESSAGE =
  'code must be 2–32 capital letters, digits or hyphens, starting with a letter or digit';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upperCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export type SoldBy = 'portion' | 'weight';
export const SOLD_BY: readonly SoldBy[] = ['portion', 'weight'];

// --- Menu items --------------------------------------------------------------------

export class CreateMenuItemDto {
  /** Upper-cased on the way in; fixed once the menu item exists. */
  @IsString()
  @Transform(upperCode)
  @Matches(MENU_CODE_PATTERN, { message: CODE_MESSAGE })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameTh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameEn!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Transform(trimmed)
  categoryTh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Transform(trimmed)
  categoryEn!: string;

  /** Fixed once the menu item exists: its prices and recipes depend on it (ADR-0005). */
  @IsIn(SOLD_BY)
  soldBy!: SoldBy;

  /** The modifier groups it offers, in the order the POS shows them. */
  @IsArray()
  @ArrayMaxSize(MODIFIER_GROUPS_MAX)
  @IsUUID('4', { each: true })
  modifierGroupIds!: string[];
}

/**
 * Every field optional except `version`, the master data version the change was made from:
 * an edit made on a stale screen is refused. `code` and `soldBy` never change.
 */
export class UpdateMenuItemDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameTh?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Transform(trimmed)
  categoryTh?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Transform(trimmed)
  categoryEn?: string;

  /** Menu items are deactivated, never deleted; `true` brings one back. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Replaces the whole list when given. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MODIFIER_GROUPS_MAX)
  @IsUUID('4', { each: true })
  modifierGroupIds?: string[];
}

export class MenuItemsQueryDto {
  /** Matches the code, either name or either category, ignoring case. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimmed)
  q?: string;

  /** `active` (the default), `inactive` or `all`. */
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'active';
}

// --- Prices ------------------------------------------------------------------------

export class SetMenuPriceDto {
  /** A branch for a branch price; null or absent for the chain-wide price. */
  @IsOptional()
  @IsUUID('4')
  locationId?: string | null;

  /** The business date it starts on, YYYY-MM-DD: today or later (ADR-0018, #48). */
  @IsString()
  effectiveFrom!: string;

  /**
   * Baht as the POS shows it, a decimal string with satang at most ("59", "59.50"). Null only
   * for a branch: from `effectiveFrom` the branch charges the chain-wide price again (ADR-0023).
   */
  @ValidateIf((dto: SetMenuPriceDto) => dto.price !== null)
  @IsString()
  @Transform(trimmed)
  price!: string | null;
}

// --- Modifier groups ----------------------------------------------------------------

export class ModifierOptionDto {
  @IsString()
  @Transform(upperCode)
  @Matches(MENU_CODE_PATTERN, { message: CODE_MESSAGE })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameTh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameEn!: string;

  /** Added to the line's price per unit sold, a decimal string; may be negative or zero. */
  @IsString()
  @Transform(trimmed)
  priceChange!: string;

  /** Options are deactivated, never removed. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateModifierGroupDto {
  @IsString()
  @Transform(upperCode)
  @Matches(MENU_CODE_PATTERN, { message: CODE_MESSAGE })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameTh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameEn!: string;

  @IsInt()
  @Min(0)
  @Max(SELECTIONS_MAX)
  minSelections!: number;

  @IsInt()
  @Min(1)
  @Max(SELECTIONS_MAX)
  maxSelections!: number;

  /** In the order the POS shows them. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MODIFIER_OPTIONS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ModifierOptionDto)
  options!: ModifierOptionDto[];
}

/**
 * Every field optional except `version`. `options`, when given, is the whole list in its new
 * order: every existing option must still be in it (deactivate one rather than remove it),
 * and an option whose code is new is added.
 */
export class UpdateModifierGroupDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameTh?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameEn?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SELECTIONS_MAX)
  minSelections?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SELECTIONS_MAX)
  maxSelections?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MODIFIER_OPTIONS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ModifierOptionDto)
  options?: ModifierOptionDto[];
}

// --- Recipes ------------------------------------------------------------------------

export class RecipeLineDto {
  @IsUUID('4')
  itemId!: string;

  /**
   * In the item's base unit, a decimal string: per portion or per kilogram sold for a menu
   * recipe; per one unit sold of the line for a modifier recipe, negative to remove.
   */
  @IsString()
  @Transform(trimmed)
  quantity!: string;
}

export class RecipeLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RECIPE_LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  lines!: RecipeLineDto[];
}

export class CreateRecipeVersionDto extends RecipeLinesDto {
  /** The business date it starts on, YYYY-MM-DD (ADR-0018, #48). */
  @IsString()
  effectiveFrom!: string;
}

// --- Views --------------------------------------------------------------------------

export interface LocationRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
}

export interface MenuPriceView {
  id: string;
  /** Null for the chain-wide price. */
  location: LocationRef | null;
  effectiveFrom: string;
  /** Null when a branch returns to the chain-wide price from `effectiveFrom`. */
  price: string | null;
  /** Today it is the price in force for its branch (or for the chain), or not yet or no longer. */
  status: 'current' | 'scheduled' | 'past';
  version: number;
}

export interface MenuItemView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  categoryTh: string;
  categoryEn: string;
  soldBy: SoldBy;
  active: boolean;
  modifierGroups: Array<{ id: string; code: string; nameTh: string; nameEn: string }>;
  /** The chain-wide price in force today, or null when none has started. */
  currentPrice: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuItemDetailView extends MenuItemView {
  /** Newest effective-from first, chain-wide before branch prices on the same day. */
  prices: MenuPriceView[];
}

export interface ModifierOptionView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  priceChange: string;
  active: boolean;
}

export interface ModifierGroupView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  minSelections: number;
  maxSelections: number;
  active: boolean;
  options: ModifierOptionView[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipeLineView {
  lineNo: number;
  item: { id: string; code: string; nameTh: string; nameEn: string; baseUnitCode: string };
  quantity: string;
  /** The item's current lot cost per base unit, or null when no lot offers one. */
  unitCost: string | null;
  /** The lot that cost comes from. */
  costLot: string | null;
  /** quantity × unitCost, or null without a cost. */
  cost: string | null;
}

export interface RecipeVersionView {
  id: string;
  number: number;
  effectiveFrom: string;
  /** In force today, still to start, or replaced by a later version. */
  status: 'current' | 'scheduled' | 'past';
  lines: RecipeLineView[];
  /**
   * The theoretical ingredient cost of one portion (per kilogram sold for weighed items, per
   * unit sold for a modifier) at current lot costs. An estimate (ADR-0023); `complete` is
   * false when a line has no cost, and `total` is then only the lines that have one.
   */
  theoreticalCost: { total: string; complete: boolean };
  version: number;
}

export interface RecipeView {
  subject: {
    kind: 'menu' | 'modifier';
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    /** What one unit of the recipe is: a portion, a kilogram sold, or a unit sold of the line. */
    per: 'portion' | 'kg' | 'unit_sold';
  };
  /** Today's business date, which `status` is measured against. */
  today: string;
  /** Newest first. */
  versions: RecipeVersionView[];
}
