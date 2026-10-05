-- Purchase orders with an approval threshold (#10, ADR-0024). An order commits money, not stock:
-- nothing here touches the ledger.

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('draft', 'submitted', 'approved', 'sent', 'partially_received', 'received', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "company_settings" (
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "purchase_approval_threshold" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("singleton")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'draft',
    "supplier_id" UUID NOT NULL,
    "delivery_location_id" UUID NOT NULL,
    "expected_delivery_date" DATE NOT NULL,
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "approval_threshold" DECIMAL(18,2),
    "approved_automatically" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "sent_by_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "purchase_order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_code" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_recoverable" BOOLEAN NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("purchase_order_id","line_no")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_delivery_location_id_idx" ON "purchase_orders"("delivery_location_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_order_lines_item_id_idx" ON "purchase_order_lines"("item_id");

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_delivery_location_id_fkey" FOREIGN KEY ("delivery_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_unit_code_fkey" FOREIGN KEY ("unit_code") REFERENCES "units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One row at most, and the approval threshold is money: zero or more (#10).
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_singleton" CHECK ("singleton");
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_threshold_not_negative"
  CHECK ("purchase_approval_threshold" >= 0);

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_note_length"
  CHECK ("note" IS NULL OR length("note") <= 500);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_submitted_complete"
  CHECK (("submitted_by_id" IS NULL) = ("submitted_at" IS NULL)
     AND ("submitted_by_id" IS NULL) = ("approval_threshold" IS NULL));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_complete"
  CHECK (("approved_at" IS NULL AND "approved_by_id" IS NULL AND NOT "approved_automatically")
      OR ("approved_at" IS NOT NULL AND (("approved_by_id" IS NULL) = "approved_automatically")));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rejected_complete"
  CHECK (("rejected_by_id" IS NULL) = ("rejected_at" IS NULL)
     AND ("rejected_by_id" IS NULL) = ("rejection_reason" IS NULL));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sent_complete"
  CHECK (("sent_by_id" IS NULL) = ("sent_at" IS NULL));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_complete"
  CHECK (("cancelled_by_id" IS NULL) = ("cancelled_at" IS NULL)
     AND ("cancelled_by_id" IS NULL) = ("cancellation_reason" IS NULL));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_reasons_length"
  CHECK (("rejection_reason" IS NULL OR length(btrim("rejection_reason")) BETWEEN 1 AND 500)
     AND ("cancellation_reason" IS NULL OR length(btrim("cancellation_reason")) BETWEEN 1 AND 500));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_decided_after_submitted"
  CHECK (("approved_at" IS NULL AND "rejected_at" IS NULL) OR "submitted_at" IS NOT NULL);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sent_after_approved"
  CHECK ("sent_at" IS NULL OR "approved_at" IS NOT NULL);

-- A purchase order is never deleted, its number and creator never change, and every step, once
-- taken, stays as it was taken. Rejected, cancelled and received are final. Nobody approves an
-- order they created (ADR-0008): the service refuses it first; this refuses it again for anything
-- that goes around the service.
CREATE OR REPLACE FUNCTION "erp_purchase_order_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'purchase order %: purchase orders are never deleted', OLD."number";
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status"::text IN ('rejected', 'cancelled', 'received') THEN
      RAISE EXCEPTION 'purchase order %: a % order never changes', OLD."number", OLD."status";
    END IF;
    IF NEW."number" <> OLD."number" OR NEW."created_by_id" <> OLD."created_by_id" THEN
      RAISE EXCEPTION 'purchase order %: its number and creator never change', OLD."number";
    END IF;
    IF OLD."status"::text <> 'draft' AND (
         NEW."supplier_id" <> OLD."supplier_id"
      OR NEW."delivery_location_id" <> OLD."delivery_location_id"
      OR NEW."expected_delivery_date" <> OLD."expected_delivery_date"
      OR NEW."note" IS DISTINCT FROM OLD."note") THEN
      RAISE EXCEPTION 'purchase order %: after submission an order changes only by cancelling it', OLD."number";
    END IF;
    IF OLD."submitted_at" IS NOT NULL AND (
         NEW."submitted_by_id" IS DISTINCT FROM OLD."submitted_by_id"
      OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
      OR NEW."approval_threshold" IS DISTINCT FROM OLD."approval_threshold") THEN
      RAISE EXCEPTION 'purchase order %: a submission never changes', OLD."number";
    END IF;
    IF OLD."approved_at" IS NOT NULL AND (
         NEW."approved_by_id" IS DISTINCT FROM OLD."approved_by_id"
      OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
      OR NEW."approved_automatically" <> OLD."approved_automatically") THEN
      RAISE EXCEPTION 'purchase order %: an approval never changes', OLD."number";
    END IF;
    IF OLD."sent_at" IS NOT NULL AND (
         NEW."sent_by_id" IS DISTINCT FROM OLD."sent_by_id"
      OR NEW."sent_at" IS DISTINCT FROM OLD."sent_at") THEN
      RAISE EXCEPTION 'purchase order %: sending never changes', OLD."number";
    END IF;
  END IF;
  IF NEW."approved_by_id" IS NOT NULL AND NEW."approved_by_id" = NEW."created_by_id" THEN
    RAISE EXCEPTION 'purchase order %: nobody approves an order they created (ADR-0008)', NEW."number";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_orders_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "erp_purchase_order_guard"();

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_line_positive"
  CHECK ("line_no" >= 1);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_price_positive"
  CHECK ("unit_price" > 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_factor_positive"
  CHECK ("factor" > 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_vat_rate_range"
  CHECK ("vat_rate" BETWEEN 0 AND 100);

-- An order's lines change only while it is a draft: what the approver sees is what is sent.
CREATE OR REPLACE FUNCTION "erp_purchase_order_lines_draft_only"() RETURNS trigger AS $$
DECLARE
  order_status TEXT;
  order_number TEXT;
BEGIN
  SELECT "status"::text, "number" INTO order_status, order_number FROM "purchase_orders"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."purchase_order_id" ELSE NEW."purchase_order_id" END;
  IF order_status <> 'draft' THEN
    RAISE EXCEPTION 'purchase order %: its lines are fixed once it leaves draft', order_number;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."purchase_order_id" <> OLD."purchase_order_id" THEN
    RAISE EXCEPTION 'purchase_order_lines: a line never moves to another order';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_order_lines_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_order_lines"
  FOR EACH ROW EXECUTE FUNCTION "erp_purchase_order_lines_draft_only"();
