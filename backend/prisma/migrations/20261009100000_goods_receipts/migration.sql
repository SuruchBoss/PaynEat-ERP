
-- CreateEnum
CREATE TYPE "ReceivingCondition" AS ENUM ('good', 'damaged');

-- AlterEnum
ALTER TYPE "StockDocumentType" ADD VALUE 'goods_receipt';

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "receiving_max_temperature" DECIMAL(3,1),
ADD COLUMN     "receiving_max_variance_percent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "lots" ADD COLUMN     "computed_expiry_date" DATE,
ADD COLUMN     "supplier_expiry_date" DATE;

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "received_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
ADD COLUMN     "returned_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "goods_receipts" (
    "document_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "purchase_order_line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_code" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "counted_quantity" DECIMAL(18,3) NOT NULL,
    "rejected_quantity" DECIMAL(18,3) NOT NULL,
    "counted_base_quantity" DECIMAL(18,3) NOT NULL,
    "rejected_base_quantity" DECIMAL(18,3) NOT NULL,
    "counted_pieces" DECIMAL(18,0),
    "rejected_pieces" DECIMAL(18,0),
    "temperature" DECIMAL(3,1),
    "condition" "ReceivingCondition" NOT NULL,
    "supplier_expiry_date" DATE,
    "reason" TEXT,
    "expected_base_quantity" DECIMAL(18,3),
    "findings" JSONB,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("document_id","line_no")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "supplier_return_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "receipt_line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "secondary_quantity" DECIMAL(18,0),
    "reason" TEXT NOT NULL,

    CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("supplier_return_id","line_no")
);

-- CreateIndex
CREATE INDEX "goods_receipts_purchase_order_id_idx" ON "goods_receipts"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipts_location_id_idx" ON "goods_receipts"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_lines_document_id_purchase_order_line_no_key" ON "goods_receipt_lines"("document_id", "purchase_order_line_no");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_number_key" ON "supplier_returns"("number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_goods_receipt_id_key" ON "supplier_returns"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "supplier_returns_purchase_order_id_idx" ON "supplier_returns"("purchase_order_id");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "goods_receipts"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_unit_code_fkey" FOREIGN KEY ("unit_code") REFERENCES "units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("document_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_supplier_return_id_fkey" FOREIGN KEY ("supplier_return_id") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules the database keeps even if the application forgets them (#11, ADR-0003, ADR-0007,
-- ADR-0008, ADR-0014). The new enum value 'goods_receipt' cannot be used in the transaction that
-- adds it, so nothing below compares against it.
-- ---------------------------------------------------------------------------

-- Receiving tolerances are optional; when set they are sensible (ADR-0007 decision 2).
ALTER TABLE "items" ADD CONSTRAINT "items_receiving_variance_range"
  CHECK ("receiving_max_variance_percent" IS NULL OR "receiving_max_variance_percent" BETWEEN 0 AND 100);
ALTER TABLE "items" ADD CONSTRAINT "items_receiving_temperature_range"
  CHECK ("receiving_max_temperature" IS NULL OR "receiving_max_temperature" BETWEEN -60 AND 60);

-- A received lot keeps both dates and takes the earlier one (ADR-0014 decision 1).
ALTER TABLE "lots" ADD CONSTRAINT "lots_supplier_expiry_with_computed"
  CHECK ("supplier_expiry_date" IS NULL OR "computed_expiry_date" IS NOT NULL);
ALTER TABLE "lots" ADD CONSTRAINT "lots_expiry_is_the_earlier"
  CHECK ("computed_expiry_date" IS NULL
      OR "expiry_date" = LEAST("computed_expiry_date", COALESCE("supplier_expiry_date", "computed_expiry_date")));

-- What has been received and returned against an order line only grows, and never below zero.
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_received_not_negative"
  CHECK ("received_quantity" >= 0 AND "returned_quantity" >= 0);

-- An order's lines change only while it is a draft, except for what has been received and
-- returned against them, which only goods receipts write, and which never goes down.
CREATE OR REPLACE FUNCTION "erp_purchase_order_lines_draft_only"() RETURNS trigger AS $$
DECLARE
  order_status TEXT;
  order_number TEXT;
BEGIN
  SELECT "status"::text, "number" INTO order_status, order_number FROM "purchase_orders"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."purchase_order_id" ELSE NEW."purchase_order_id" END;
  IF TG_OP = 'UPDATE' AND NEW."purchase_order_id" <> OLD."purchase_order_id" THEN
    RAISE EXCEPTION 'purchase_order_lines: a line never moves to another order';
  END IF;
  IF order_status <> 'draft' THEN
    IF TG_OP <> 'UPDATE' OR NEW."line_no" <> OLD."line_no" OR NEW."item_id" <> OLD."item_id"
       OR NEW."unit_code" <> OLD."unit_code" OR NEW."factor" <> OLD."factor"
       OR NEW."quantity" <> OLD."quantity" OR NEW."unit_price" <> OLD."unit_price"
       OR NEW."vat_rate" <> OLD."vat_rate" OR NEW."vat_recoverable" <> OLD."vat_recoverable" THEN
      RAISE EXCEPTION 'purchase order %: its lines are fixed once it leaves draft', order_number;
    END IF;
    IF NEW."received_quantity" < OLD."received_quantity" OR NEW."returned_quantity" < OLD."returned_quantity" THEN
      RAISE EXCEPTION 'purchase order %: what was received or returned never goes down', order_number;
    END IF;
  ELSIF TG_OP <> 'DELETE' AND (NEW."received_quantity" <> 0 OR NEW."returned_quantity" <> 0) THEN
    RAISE EXCEPTION 'purchase order %: nothing is received against a draft', order_number;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_submitted_complete"
  CHECK (("submitted_by_id" IS NULL) = ("submitted_at" IS NULL));
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_approved_complete"
  CHECK (("approved_by_id" IS NULL) = ("approved_at" IS NULL));
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_rejected_complete"
  CHECK (("rejected_by_id" IS NULL) = ("rejected_at" IS NULL)
     AND ("rejected_by_id" IS NULL) = ("rejection_reason" IS NULL));
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_decided_after_submitted"
  CHECK (("approved_by_id" IS NULL AND "rejected_by_id" IS NULL) OR "submitted_by_id" IS NOT NULL);
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_rejection_reason"
  CHECK ("rejection_reason" IS NULL OR length(btrim("rejection_reason")) BETWEEN 1 AND 500);

-- Nobody approves a receipt they created (ADR-0008). The service refuses it first; this refuses
-- it again for anything that goes around the service. A step, once taken, never changes, and the
-- order and location are fixed once the receipt leaves draft. Receipts are never deleted.
CREATE OR REPLACE FUNCTION "erp_goods_receipt_guard"() RETURNS trigger AS $$
DECLARE
  doc_status TEXT;
  doc_number TEXT;
  doc_creator UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'goods receipts are never deleted';
  END IF;
  SELECT "status"::text, "number", "created_by_id" INTO doc_status, doc_number, doc_creator
    FROM "stock_documents" WHERE "id" = NEW."document_id";
  IF TG_OP = 'UPDATE' THEN
    IF NEW."document_id" <> OLD."document_id" THEN
      RAISE EXCEPTION 'goods receipt: a row never moves to another document';
    END IF;
    IF (NEW."purchase_order_id" <> OLD."purchase_order_id" OR NEW."location_id" <> OLD."location_id")
       AND doc_status <> 'draft' THEN
      RAISE EXCEPTION 'stock document %: the order and location are fixed once the receipt leaves draft', doc_number;
    END IF;
    IF OLD."submitted_by_id" IS NOT NULL AND (
         NEW."submitted_by_id" IS DISTINCT FROM OLD."submitted_by_id"
      OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at") THEN
      RAISE EXCEPTION 'stock document %: a submission never changes', doc_number;
    END IF;
    IF OLD."approved_by_id" IS NOT NULL AND (
         NEW."approved_by_id" IS DISTINCT FROM OLD."approved_by_id"
      OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at") THEN
      RAISE EXCEPTION 'stock document %: an approval never changes', doc_number;
    END IF;
    IF OLD."rejected_by_id" IS NOT NULL AND (
         NEW."rejected_by_id" IS DISTINCT FROM OLD."rejected_by_id"
      OR NEW."rejected_at" IS DISTINCT FROM OLD."rejected_at"
      OR NEW."rejection_reason" IS DISTINCT FROM OLD."rejection_reason") THEN
      RAISE EXCEPTION 'stock document %: a rejection never changes', doc_number;
    END IF;
  END IF;
  IF NEW."approved_by_id" IS NOT NULL AND NEW."approved_by_id" = doc_creator THEN
    RAISE EXCEPTION 'stock document %: nobody approves a document they created (ADR-0008)', doc_number;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "goods_receipts_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "goods_receipts"
  FOR EACH ROW EXECUTE FUNCTION "erp_goods_receipt_guard"();

ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_line_positive"
  CHECK ("line_no" >= 1 AND "purchase_order_line_no" >= 1);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_factor_positive"
  CHECK ("factor" > 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_counted_split"
  CHECK ("counted_quantity" > 0 AND "rejected_quantity" >= 0 AND "rejected_quantity" <= "counted_quantity"
     AND "counted_base_quantity" > 0 AND "rejected_base_quantity" >= 0
     AND "rejected_base_quantity" <= "counted_base_quantity");
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_pieces_split"
  CHECK (("counted_pieces" IS NULL) = ("rejected_pieces" IS NULL)
     AND ("counted_pieces" IS NULL
          OR ("counted_pieces" > 0 AND "rejected_pieces" >= 0 AND "rejected_pieces" <= "counted_pieces")));
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_temperature_range"
  CHECK ("temperature" IS NULL OR "temperature" BETWEEN -60 AND 60);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_reason_length"
  CHECK ("reason" IS NULL OR length(btrim("reason")) BETWEEN 1 AND 500);

CREATE TRIGGER "goods_receipt_lines_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "goods_receipt_lines"
  FOR EACH ROW EXECUTE FUNCTION "erp_draft_only"();

-- A return to supplier is written once, when its receipt posts, and never changes.
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_line_positive"
  CHECK ("line_no" >= 1 AND "receipt_line_no" >= 1);
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_quantity_positive"
  CHECK ("quantity" > 0 AND ("secondary_quantity" IS NULL OR "secondary_quantity" > 0));
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_reason_present"
  CHECK (length(btrim("reason")) BETWEEN 1 AND 500);

CREATE TRIGGER "supplier_returns_append_only"
  BEFORE UPDATE OR DELETE ON "supplier_returns"
  FOR EACH ROW EXECUTE FUNCTION "erp_append_only"();

CREATE TRIGGER "supplier_return_lines_append_only"
  BEFORE UPDATE OR DELETE ON "supplier_return_lines"
  FOR EACH ROW EXECUTE FUNCTION "erp_append_only"();
