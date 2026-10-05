-- Menu items, prices, modifiers and versioned recipes as ERP master data (#16, ADR-0023).

-- CreateEnum
CREATE TYPE "MenuSoldBy" AS ENUM ('portion', 'weight');

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "category_th" TEXT NOT NULL,
    "category_en" TEXT NOT NULL,
    "sold_by" "MenuSoldBy" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_modifier_groups" (
    "menu_item_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "menu_item_modifier_groups_pkey" PRIMARY KEY ("menu_item_id","group_id")
);

-- CreateTable
CREATE TABLE "menu_prices" (
    "id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "location_id" UUID,
    "effective_from" DATE NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "version" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "min_selections" INTEGER NOT NULL,
    "max_selections" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_options" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "price_change" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifier_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_versions" (
    "id" UUID NOT NULL,
    "menu_item_id" UUID,
    "modifier_option_id" UUID,
    "number" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "version" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recipe_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_lines" (
    "recipe_version_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("recipe_version_id","line_no")
);

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_code_key" ON "menu_items"("code");

-- CreateIndex
CREATE INDEX "menu_prices_menu_item_id_effective_from_idx" ON "menu_prices"("menu_item_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_groups_code_key" ON "modifier_groups"("code");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_options_code_key" ON "modifier_options"("code");

-- CreateIndex
CREATE INDEX "modifier_options_group_id_idx" ON "modifier_options"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_menu_item_id_effective_from_key" ON "recipe_versions"("menu_item_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_menu_item_id_number_key" ON "recipe_versions"("menu_item_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_modifier_option_id_effective_from_key" ON "recipe_versions"("modifier_option_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_modifier_option_id_number_key" ON "recipe_versions"("modifier_option_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_lines_recipe_version_id_item_id_key" ON "recipe_lines"("recipe_version_id", "item_id");

-- AddForeignKey
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "modifier_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_prices" ADD CONSTRAINT "menu_prices_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_prices" ADD CONSTRAINT "menu_prices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "modifier_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_modifier_option_id_fkey" FOREIGN KEY ("modifier_option_id") REFERENCES "modifier_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "recipe_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Codes are the ecosystem-wide shape: the codes sales events carry (contract 1.x).
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{1,31}$');
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{1,31}$');
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{1,31}$');

ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_selections" CHECK (
  "min_selections" >= 0 AND "max_selections" >= 1 AND "max_selections" >= "min_selections"
);

-- A selling price is never negative; one per menu item, branch (or the whole chain) and day.
ALTER TABLE "menu_prices" ADD CONSTRAINT "menu_prices_price_not_negative" CHECK ("price" >= 0);
CREATE UNIQUE INDEX "menu_prices_one_per_day" ON "menu_prices"("menu_item_id", "location_id", "effective_from") NULLS NOT DISTINCT;

-- A recipe version belongs to exactly one menu item or one modifier option.
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_one_subject" CHECK (num_nonnulls("menu_item_id", "modifier_option_id") = 1);
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_number_positive" CHECK ("number" > 0);
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_quantity_not_zero" CHECK ("quantity" <> 0);

-- A menu item's code and how it is sold never change: sales events and recipes depend on both.
CREATE OR REPLACE FUNCTION "erp_menu_item_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."code" <> OLD."code" OR NEW."sold_by" <> OLD."sold_by" THEN
    RAISE EXCEPTION 'a menu item''s code and sold_by never change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "menu_items_guard"
  BEFORE UPDATE ON "menu_items"
  FOR EACH ROW EXECUTE FUNCTION "erp_menu_item_guard"();

-- Menu master data is deactivated, never deleted: the change log, the audit trail and sales
-- keep pointing at it. A recipe version's lines are replaced only before it takes effect,
-- which the API enforces. TRUNCATE stays possible for the end-to-end suite.
CREATE TRIGGER "menu_items_never_deleted"
  BEFORE DELETE ON "menu_items"
  FOR EACH ROW EXECUTE FUNCTION "erp_never_deleted"();

CREATE TRIGGER "menu_prices_never_deleted"
  BEFORE DELETE ON "menu_prices"
  FOR EACH ROW EXECUTE FUNCTION "erp_never_deleted"();

CREATE TRIGGER "modifier_groups_never_deleted"
  BEFORE DELETE ON "modifier_groups"
  FOR EACH ROW EXECUTE FUNCTION "erp_never_deleted"();

CREATE TRIGGER "modifier_options_never_deleted"
  BEFORE DELETE ON "modifier_options"
  FOR EACH ROW EXECUTE FUNCTION "erp_never_deleted"();

CREATE TRIGGER "recipe_versions_never_deleted"
  BEFORE DELETE ON "recipe_versions"
  FOR EACH ROW EXECUTE FUNCTION "erp_never_deleted"();
