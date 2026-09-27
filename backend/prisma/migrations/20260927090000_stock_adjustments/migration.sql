-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'APPROVE';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockDocumentStatus" ADD VALUE 'submitted';
ALTER TYPE "StockDocumentStatus" ADD VALUE 'approved';
ALTER TYPE "StockDocumentStatus" ADD VALUE 'rejected';

-- AlterEnum
ALTER TYPE "StockDocumentType" ADD VALUE 'stock_adjustment';

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "document_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "lot_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "secondary_quantity" DECIMAL(18,0),
    "reason" TEXT NOT NULL,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("document_id","line_no")
);

-- CreateIndex
CREATE INDEX "stock_adjustments_location_id_idx" ON "stock_adjustments"("location_id");

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_adjustments"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_lot_id_item_id_fkey" FOREIGN KEY ("lot_id", "item_id") REFERENCES "lots"("id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules the database keeps even if the application forgets them (#8, ADR-0003, ADR-0008).
-- A new enum value cannot be used in the transaction that adds it, so the checks below compare
-- against 'posted' and 'draft', which already existed, or compare as text.
-- ---------------------------------------------------------------------------

-- Posted means posted by someone at some time; a document in any other state has neither.
ALTER TABLE "stock_documents" DROP CONSTRAINT "stock_documents_posted_complete";
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_posted_complete"
  CHECK (("status" = 'posted' AND "posted_by_id" IS NOT NULL AND "posted_at" IS NOT NULL)
      OR ("status" <> 'posted' AND "posted_by_id" IS NULL AND "posted_at" IS NULL));

-- Posted and rejected are final: a posted document is corrected by a reversal, a rejected one by
-- raising a new one. No document is ever deleted.
CREATE OR REPLACE FUNCTION "erp_stock_document_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock document %: documents are never deleted', OLD."number";
  END IF;
  IF OLD."status"::text = 'posted' THEN
    RAISE EXCEPTION 'stock document %: a posted document never changes; reverse it instead', OLD."number";
  END IF;
  IF OLD."status"::text = 'rejected' THEN
    RAISE EXCEPTION 'stock document %: a rejected document never changes; raise a new one', OLD."number";
  END IF;
  IF NEW."type" <> OLD."type" OR NEW."number" <> OLD."number" OR NEW."created_by_id" <> OLD."created_by_id" THEN
    RAISE EXCEPTION 'stock document %: its type, number and creator never change', OLD."number";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A document's lines change only while it is a draft: once submitted, what the approver sees is
-- what posts. Opening balances were only ever draft or posted, so they behave as before.
CREATE OR REPLACE FUNCTION "erp_draft_only"() RETURNS trigger AS $$
DECLARE
  doc_status TEXT;
  doc_number TEXT;
BEGIN
  SELECT "status"::text, "number" INTO doc_status, doc_number FROM "stock_documents"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."document_id" ELSE NEW."document_id" END;
  IF doc_status <> 'draft' THEN
    RAISE EXCEPTION 'stock document %: % is fixed once the document leaves draft', doc_number, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."document_id" <> OLD."document_id" THEN
    RAISE EXCEPTION '%: a row never moves to another document', TG_TABLE_NAME;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_submitted_complete"
  CHECK (("submitted_by_id" IS NULL) = ("submitted_at" IS NULL));
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approved_complete"
  CHECK (("approved_by_id" IS NULL) = ("approved_at" IS NULL));
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_rejected_complete"
  CHECK (("rejected_by_id" IS NULL) = ("rejected_at" IS NULL)
     AND ("rejected_by_id" IS NULL) = ("rejection_reason" IS NULL));
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_decided_after_submitted"
  CHECK (("approved_by_id" IS NULL AND "rejected_by_id" IS NULL) OR "submitted_by_id" IS NOT NULL);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_rejection_reason"
  CHECK ("rejection_reason" IS NULL OR length(btrim("rejection_reason")) BETWEEN 1 AND 500);

-- Nobody approves a document they created (ADR-0008). The service refuses it first; this refuses
-- it again for anything that goes around the service. An approval or a rejection, once made,
-- never changes, and an adjustment's location is fixed once it leaves draft.
CREATE OR REPLACE FUNCTION "erp_stock_adjustment_guard"() RETURNS trigger AS $$
DECLARE
  doc_status TEXT;
  doc_number TEXT;
  doc_creator UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock adjustments are never deleted';
  END IF;
  SELECT "status"::text, "number", "created_by_id" INTO doc_status, doc_number, doc_creator
    FROM "stock_documents" WHERE "id" = NEW."document_id";
  IF TG_OP = 'UPDATE' THEN
    IF NEW."document_id" <> OLD."document_id" THEN
      RAISE EXCEPTION 'stock adjustment: a row never moves to another document';
    END IF;
    IF NEW."location_id" <> OLD."location_id" AND doc_status <> 'draft' THEN
      RAISE EXCEPTION 'stock document %: the location is fixed once the document leaves draft', doc_number;
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

CREATE TRIGGER "stock_adjustments_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "stock_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "erp_stock_adjustment_guard"();

ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_line_positive"
  CHECK ("line_no" >= 1);
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_quantity_not_zero"
  CHECK ("quantity" <> 0);
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_secondary_same_sign"
  CHECK ("secondary_quantity" IS NULL
      OR ("secondary_quantity" <> 0 AND sign("secondary_quantity") = sign("quantity")));
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_reason_present"
  CHECK (length(btrim("reason")) BETWEEN 1 AND 200);

CREATE TRIGGER "stock_adjustment_lines_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "stock_adjustment_lines"
  FOR EACH ROW EXECUTE FUNCTION "erp_draft_only"();
