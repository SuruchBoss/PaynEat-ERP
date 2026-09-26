-- CreateEnum
CREATE TYPE "MasterDataAction" AS ENUM ('created', 'updated');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "demo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "units" (
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "base_unit_code" TEXT NOT NULL,
    "variable_weight" BOOLEAN NOT NULL DEFAULT false,
    "shelf_life_days" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_purchase_units" (
    "item_id" UUID NOT NULL,
    "unit_code" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "item_purchase_units_pkey" PRIMARY KEY ("item_id","unit_code")
);

-- CreateTable
CREATE TABLE "master_data_version" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "master_data_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_data_changes" (
    "version" BIGINT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_code" TEXT NOT NULL,
    "action" "MasterDataAction" NOT NULL,
    "data" JSONB NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_data_changes_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE UNIQUE INDEX "items_code_key" ON "items"("code");

-- CreateIndex
CREATE INDEX "master_data_changes_entity_type_entity_id_idx" ON "master_data_changes"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_base_unit_code_fkey" FOREIGN KEY ("base_unit_code") REFERENCES "units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_purchase_units" ADD CONSTRAINT "item_purchase_units_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_purchase_units" ADD CONSTRAINT "item_purchase_units_unit_code_fkey" FOREIGN KEY ("unit_code") REFERENCES "units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written from here on.

-- The same shape as a location code (docs/GLOSSARY.md), so the POS, the ERP and a
-- spreadsheet all accept the same codes. Fixed once created: the POS keys its mirror on it.
ALTER TABLE "items" ADD CONSTRAINT "items_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{1,31}$');
ALTER TABLE "items" ADD CONSTRAINT "items_shelf_life_days_range" CHECK ("shelf_life_days" BETWEEN 1 AND 36500);
ALTER TABLE "items" ADD CONSTRAINT "items_version_positive" CHECK ("version" > 0);
-- A zero or negative factor would turn a delivery into nothing or into a withdrawal
-- (ADR-0005, ADR-0019). The API refuses it first; this is the backstop.
ALTER TABLE "item_purchase_units" ADD CONSTRAINT "item_purchase_units_factor_positive" CHECK ("factor" > 0);
ALTER TABLE "units" ADD CONSTRAINT "units_decimals_range" CHECK ("decimals" BETWEEN 0 AND 6);

-- The company-wide master data version is one row, bumped inside the writer's own
-- transaction: the row lock serialises writers, so versions commit in order and a reader
-- never sees version N+1 before N (ADR-0002).
ALTER TABLE "master_data_version" ADD CONSTRAINT "master_data_version_single_row" CHECK ("id" = 1);
ALTER TABLE "master_data_version" ADD CONSTRAINT "master_data_version_not_negative" CHECK ("version" >= 0);
INSERT INTO "master_data_version" ("id", "version") VALUES (1, 0);

-- The change log is what every POS instance replays; rewriting it would desynchronise them.
CREATE TRIGGER "master_data_changes_append_only"
  BEFORE UPDATE OR DELETE ON "master_data_changes"
  FOR EACH ROW EXECUTE FUNCTION "erp_append_only"();

-- The unit catalogue. Units are not company data: every installation needs the same ones,
-- so they ship with the release (a new unit is a migration). `decimals` is how finely a
-- quantity in that unit is kept: grams of chicken, whole pieces.
INSERT INTO "units" ("code", "name_th", "name_en", "decimals") VALUES
  ('kg',     'กิโลกรัม',  'kilogram',   3),
  ('g',      'กรัม',      'gram',       0),
  ('l',      'ลิตร',      'litre',      3),
  ('ml',     'มิลลิลิตร', 'millilitre', 0),
  ('piece',  'ชิ้น',      'piece',      0),
  ('pack',   'แพ็ก',      'pack',       0),
  ('case',   'ลัง',       'case',       0),
  ('bag',    'ถุง',       'bag',        0),
  ('sack',   'กระสอบ',    'sack',       0),
  ('bottle', 'ขวด',       'bottle',     0),
  ('tin',    'ปี๊บ',      'tin',        0),
  ('box',    'กล่อง',     'box',        0),
  ('tray',   'ถาด',       'tray',       0);
