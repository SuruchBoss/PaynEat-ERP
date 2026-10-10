-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockDocumentStatus" ADD VALUE 'released';
ALTER TYPE "StockDocumentStatus" ADD VALUE 'cancelled';

-- AlterEnum
ALTER TYPE "StockDocumentType" ADD VALUE 'production_order';

-- CreateTable
CREATE TABLE "lot_genealogy" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "output_lot_id" UUID NOT NULL,
    "input_lot_id" UUID NOT NULL,
    "input_quantity" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_genealogy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "document_id" UUID NOT NULL,
    "bom_version_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "planned_quantity" DECIMAL(18,3) NOT NULL,
    "released_by_id" UUID,
    "released_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "actual_yield_percent" DECIMAL(7,2),
    "expected_yield_percent" DECIMAL(7,2),

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "production_order_inputs" (
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "planned_quantity" DECIMAL(18,3) NOT NULL,
    "actual_weight_kg" DECIMAL(15,3),
    "picks_overridden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "production_order_inputs_pkey" PRIMARY KEY ("document_id","line_no")
);

-- CreateTable
CREATE TABLE "production_order_picks" (
    "document_id" UUID NOT NULL,
    "input_line_no" INTEGER NOT NULL,
    "lot_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "secondary_quantity" DECIMAL(18,0),

    CONSTRAINT "production_order_picks_pkey" PRIMARY KEY ("document_id","input_line_no","lot_id")
);

-- CreateTable
CREATE TABLE "production_order_outputs" (
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "planned_quantity" DECIMAL(18,3) NOT NULL,
    "allocation_ratio" DECIMAL(5,2) NOT NULL,
    "actual_quantity" DECIMAL(18,3),
    "actual_pieces" DECIMAL(18,0),
    "actual_weight_kg" DECIMAL(15,3),
    "allocated_value" DECIMAL,
    "rounding_difference" DECIMAL,

    CONSTRAINT "production_order_outputs_pkey" PRIMARY KEY ("document_id","line_no")
);

-- CreateIndex
CREATE INDEX "lot_genealogy_input_lot_id_idx" ON "lot_genealogy"("input_lot_id");

-- CreateIndex
CREATE INDEX "lot_genealogy_output_lot_id_idx" ON "lot_genealogy"("output_lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_genealogy_document_id_output_lot_id_input_lot_id_key" ON "lot_genealogy"("document_id", "output_lot_id", "input_lot_id");

-- CreateIndex
CREATE INDEX "production_orders_bom_version_id_idx" ON "production_orders"("bom_version_id");

-- CreateIndex
CREATE INDEX "production_orders_location_id_idx" ON "production_orders"("location_id");

-- AddForeignKey
ALTER TABLE "lot_genealogy" ADD CONSTRAINT "lot_genealogy_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_genealogy" ADD CONSTRAINT "lot_genealogy_output_lot_id_fkey" FOREIGN KEY ("output_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_genealogy" ADD CONSTRAINT "lot_genealogy_input_lot_id_fkey" FOREIGN KEY ("input_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bom_version_id_fkey" FOREIGN KEY ("bom_version_id") REFERENCES "production_bom_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_inputs" ADD CONSTRAINT "production_order_inputs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "production_orders"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_inputs" ADD CONSTRAINT "production_order_inputs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_picks" ADD CONSTRAINT "production_order_picks_document_id_input_line_no_fkey" FOREIGN KEY ("document_id", "input_line_no") REFERENCES "production_order_inputs"("document_id", "line_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_picks" ADD CONSTRAINT "production_order_picks_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_outputs" ADD CONSTRAINT "production_order_outputs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "production_orders"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_outputs" ADD CONSTRAINT "production_order_outputs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Rules the database keeps even if the application forgets them (#13, ADR-0003, ADR-0006,
-- ADR-0027). The enum values added above cannot be used in this transaction, so the checks below
-- compare statuses as text.
-- ---------------------------------------------------------------------------

-- Posted, rejected and cancelled are final: a posted document is corrected by a reversal, a
-- rejected or cancelled one by raising a new one. No document is ever deleted.
CREATE OR REPLACE FUNCTION "erp_stock_document_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock document %: documents are never deleted', OLD."number";
  END IF;
  IF OLD."status"::text = 'posted' THEN
    RAISE EXCEPTION 'stock document %: a posted document never changes; reverse it instead', OLD."number";
  END IF;
  IF OLD."status"::text IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'stock document %: a % document never changes; raise a new one', OLD."number", OLD."status";
  END IF;
  IF NEW."type" <> OLD."type" OR NEW."number" <> OLD."number" OR NEW."created_by_id" <> OLD."created_by_id" THEN
    RAISE EXCEPTION 'stock document %: its type, number and creator never change', OLD."number";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Lot genealogy is history: written by the posting, never changed or deleted (ADR-0006).
ALTER TABLE "lot_genealogy" ADD CONSTRAINT "lot_genealogy_quantity_positive"
  CHECK ("input_quantity" > 0);
ALTER TABLE "lot_genealogy" ADD CONSTRAINT "lot_genealogy_not_itself"
  CHECK ("output_lot_id" <> "input_lot_id");
CREATE TRIGGER "lot_genealogy_append_only"
  BEFORE UPDATE OR DELETE ON "lot_genealogy"
  FOR EACH ROW EXECUTE FUNCTION "erp_append_only"();

ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_planned_positive"
  CHECK ("planned_quantity" > 0);
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_released_complete"
  CHECK (("released_by_id" IS NULL) = ("released_at" IS NULL));
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_cancelled_complete"
  CHECK (("cancelled_by_id" IS NULL) = ("cancelled_at" IS NULL)
     AND ("cancelled_by_id" IS NULL) = ("cancellation_reason" IS NULL));
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_cancellation_reason_length"
  CHECK ("cancellation_reason" IS NULL OR length(btrim("cancellation_reason")) BETWEEN 1 AND 500);
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_yields_together"
  CHECK (("actual_yield_percent" IS NULL) = ("expected_yield_percent" IS NULL));

-- An order is planned while it is a draft and worked while it is released; once posted or
-- cancelled it never changes, and it is never deleted. Its BOM version, plant and plan are fixed
-- when it is released.
CREATE OR REPLACE FUNCTION "erp_production_order_guard"() RETURNS trigger AS $$
DECLARE
  doc_status TEXT;
  doc_number TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'production order: orders are never deleted';
  END IF;
  SELECT "status"::text, "number" INTO doc_status, doc_number FROM "stock_documents"
    WHERE "id" = NEW."document_id";
  IF TG_OP = 'UPDATE' THEN
    IF doc_status NOT IN ('draft', 'released') THEN
      RAISE EXCEPTION 'production order %: a % order never changes', doc_number, doc_status;
    END IF;
    IF NEW."document_id" <> OLD."document_id" THEN
      RAISE EXCEPTION 'production order %: it never moves to another document', doc_number;
    END IF;
    IF doc_status <> 'draft' AND (NEW."bom_version_id" <> OLD."bom_version_id"
        OR NEW."location_id" <> OLD."location_id" OR NEW."planned_quantity" <> OLD."planned_quantity") THEN
      RAISE EXCEPTION 'production order %: its BOM version, plant and plan are fixed once released', doc_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "production_orders_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "production_orders"
  FOR EACH ROW EXECUTE FUNCTION "erp_production_order_guard"();

-- An order's lines change while it is a draft or released, never after.
CREATE OR REPLACE FUNCTION "erp_production_lines_open"() RETURNS trigger AS $$
DECLARE
  doc_status TEXT;
  doc_number TEXT;
BEGIN
  SELECT "status"::text, "number" INTO doc_status, doc_number FROM "stock_documents"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."document_id" ELSE NEW."document_id" END;
  IF doc_status NOT IN ('draft', 'released') THEN
    RAISE EXCEPTION 'production order %: % is fixed once the order is %', doc_number, TG_TABLE_NAME, doc_status;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."document_id" <> OLD."document_id" THEN
    RAISE EXCEPTION '%: a row never moves to another order', TG_TABLE_NAME;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "production_order_inputs" ADD CONSTRAINT "production_order_inputs_values"
  CHECK ("line_no" >= 1 AND "planned_quantity" > 0
     AND ("actual_weight_kg" IS NULL OR "actual_weight_kg" >= 0));
CREATE TRIGGER "production_order_inputs_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "production_order_inputs"
  FOR EACH ROW EXECUTE FUNCTION "erp_production_lines_open"();

ALTER TABLE "production_order_picks" ADD CONSTRAINT "production_order_picks_values"
  CHECK ("input_line_no" >= 1 AND "quantity" > 0
     AND ("secondary_quantity" IS NULL OR "secondary_quantity" >= 0));
CREATE TRIGGER "production_order_picks_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "production_order_picks"
  FOR EACH ROW EXECUTE FUNCTION "erp_production_lines_open"();

ALTER TABLE "production_order_outputs" ADD CONSTRAINT "production_order_outputs_values"
  CHECK ("line_no" >= 1 AND "planned_quantity" >= 0
     AND "allocation_ratio" > 0 AND "allocation_ratio" <= 100
     AND ("actual_quantity" IS NULL OR "actual_quantity" >= 0)
     AND ("actual_pieces" IS NULL OR "actual_pieces" >= 0)
     AND ("actual_weight_kg" IS NULL OR "actual_weight_kg" >= 0));
-- The allocation is written whole, at posting, or not at all (ADR-0027).
ALTER TABLE "production_order_outputs" ADD CONSTRAINT "production_order_outputs_cost_together"
  CHECK (("allocated_value" IS NULL) = ("rounding_difference" IS NULL)
     AND ("allocated_value" IS NULL OR "actual_quantity" > 0));
CREATE TRIGGER "production_order_outputs_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "production_order_outputs"
  FOR EACH ROW EXECUTE FUNCTION "erp_production_lines_open"();
