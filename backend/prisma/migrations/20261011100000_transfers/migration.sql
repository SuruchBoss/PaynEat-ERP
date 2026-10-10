-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockDocumentType" ADD VALUE 'transfer';
ALTER TYPE "StockDocumentType" ADD VALUE 'transfer_receipt';

-- CreateTable
CREATE TABLE "transfers" (
    "document_id" UUID NOT NULL,
    "origin_id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "receipt_document_id" UUID,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "transfer_lines" (
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "transfer_lines_pkey" PRIMARY KEY ("document_id","line_no")
);

-- CreateTable
CREATE TABLE "transfer_picks" (
    "document_id" UUID NOT NULL,
    "pick_no" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "lot_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "secondary_quantity" DECIMAL(18,0),

    CONSTRAINT "transfer_picks_pkey" PRIMARY KEY ("document_id","pick_no")
);

-- CreateTable
CREATE TABLE "transfer_receipts" (
    "document_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,

    CONSTRAINT "transfer_receipts_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "transfer_receipt_lines" (
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "lot_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "received" DECIMAL(18,3) NOT NULL,
    "received_pieces" DECIMAL(18,0),
    "temperature" DECIMAL(3,1),
    "condition" "ReceivingCondition" NOT NULL,
    "accepted" DECIMAL(18,3) NOT NULL,
    "accepted_pieces" DECIMAL(18,0),
    "returned" DECIMAL(18,3) NOT NULL,
    "returned_pieces" DECIMAL(18,0),
    "written_off" DECIMAL(18,3) NOT NULL,
    "written_off_pieces" DECIMAL(18,0),
    "reason" TEXT,
    "findings" JSONB,

    CONSTRAINT "transfer_receipt_lines_pkey" PRIMARY KEY ("document_id","line_no")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfers_receipt_document_id_key" ON "transfers"("receipt_document_id");

-- CreateIndex
CREATE INDEX "transfers_origin_id_idx" ON "transfers"("origin_id");

-- CreateIndex
CREATE INDEX "transfers_destination_id_idx" ON "transfers"("destination_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_lines_document_id_item_id_key" ON "transfer_lines"("document_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_picks_document_id_lot_id_key" ON "transfer_picks"("document_id", "lot_id");

-- CreateIndex
CREATE INDEX "transfer_receipts_transfer_id_idx" ON "transfer_receipts"("transfer_id");

-- CreateIndex
CREATE INDEX "transfer_receipts_location_id_idx" ON "transfer_receipts"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_receipt_lines_document_id_lot_id_key" ON "transfer_receipt_lines"("document_id", "lot_id");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_receipt_document_id_fkey" FOREIGN KEY ("receipt_document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "transfers"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_picks" ADD CONSTRAINT "transfer_picks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "transfers"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_picks" ADD CONSTRAINT "transfer_picks_document_id_line_no_fkey" FOREIGN KEY ("document_id", "line_no") REFERENCES "transfer_lines"("document_id", "line_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_picks" ADD CONSTRAINT "transfer_picks_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("document_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "transfer_receipts"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules the database keeps even if the application forgets them (#14, ADR-0003, ADR-0007,
-- ADR-0008, ADR-0028). The enum values added above cannot be used in this transaction, so the
-- checks below compare statuses as text.
-- ---------------------------------------------------------------------------

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_not_to_itself"
  CHECK ("origin_id" <> "destination_id");
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_cancelled_complete"
  CHECK (("cancelled_by_id" IS NULL) = ("cancelled_at" IS NULL)
     AND ("cancelled_by_id" IS NULL) = ("cancellation_reason" IS NULL));
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_cancellation_reason_length"
  CHECK ("cancellation_reason" IS NULL OR length(btrim("cancellation_reason")) BETWEEN 1 AND 500);
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_received_or_cancelled"
  CHECK ("receipt_document_id" IS NULL OR "cancelled_by_id" IS NULL);

-- A transfer's route changes only while it is a draft; it is cancelled once, received once (by
-- the one receipt that posts), and never deleted.
CREATE OR REPLACE FUNCTION "erp_transfer_guard"() RETURNS trigger AS $$
DECLARE
  doc_status TEXT;
  doc_number TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transfers are never deleted';
  END IF;
  SELECT "status"::text, "number" INTO doc_status, doc_number FROM "stock_documents"
    WHERE "id" = NEW."document_id";
  IF TG_OP = 'UPDATE' THEN
    IF NEW."document_id" <> OLD."document_id" THEN
      RAISE EXCEPTION 'transfer %: a row never moves to another document', doc_number;
    END IF;
    IF (NEW."origin_id" <> OLD."origin_id" OR NEW."destination_id" <> OLD."destination_id")
       AND doc_status <> 'draft' THEN
      RAISE EXCEPTION 'transfer %: its origin and destination are fixed once it leaves draft', doc_number;
    END IF;
    IF OLD."cancelled_by_id" IS NOT NULL AND (
         NEW."cancelled_by_id" IS DISTINCT FROM OLD."cancelled_by_id"
      OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
      OR NEW."cancellation_reason" IS DISTINCT FROM OLD."cancellation_reason") THEN
      RAISE EXCEPTION 'transfer %: a cancellation never changes', doc_number;
    END IF;
    IF NEW."cancelled_by_id" IS NOT NULL AND OLD."cancelled_by_id" IS NULL AND doc_status <> 'draft' THEN
      RAISE EXCEPTION 'transfer %: only a draft is cancelled; a dispatched transfer is received', doc_number;
    END IF;
    IF OLD."receipt_document_id" IS NOT NULL
       AND NEW."receipt_document_id" IS DISTINCT FROM OLD."receipt_document_id" THEN
      RAISE EXCEPTION 'transfer %: it is received once', doc_number;
    END IF;
    IF NEW."receipt_document_id" IS NOT NULL AND OLD."receipt_document_id" IS NULL
       AND doc_status <> 'posted' THEN
      RAISE EXCEPTION 'transfer %: only a dispatched transfer is received', doc_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "transfers_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "transfers"
  FOR EACH ROW EXECUTE FUNCTION "erp_transfer_guard"();

ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_values"
  CHECK ("line_no" >= 1 AND "quantity" > 0);
CREATE TRIGGER "transfer_lines_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "transfer_lines"
  FOR EACH ROW EXECUTE FUNCTION "erp_draft_only"();

-- What left is written by the dispatch, inside its posting, and never changes after.
ALTER TABLE "transfer_picks" ADD CONSTRAINT "transfer_picks_values"
  CHECK ("pick_no" >= 1 AND "line_no" >= 1 AND "quantity" > 0
     AND ("secondary_quantity" IS NULL OR "secondary_quantity" >= 0));
CREATE TRIGGER "transfer_picks_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "transfer_picks"
  FOR EACH ROW EXECUTE FUNCTION "erp_draft_only"();

ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_decided_after_submitted"
  CHECK (("approved_by_id" IS NULL AND "rejected_by_id" IS NULL) OR "submitted_by_id" IS NOT NULL);
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_rejection_reason"
  CHECK ("rejection_reason" IS NULL OR length(btrim("rejection_reason")) BETWEEN 1 AND 500);

-- Nobody approves a receipt they created (ADR-0008). The service refuses it first; this refuses
-- it again for anything that goes around the service. A step, once taken, never changes, and the
-- transfer and location never change. Receipts are never deleted.
CREATE OR REPLACE FUNCTION "erp_transfer_receipt_guard"() RETURNS trigger AS $$
DECLARE
  doc_number TEXT;
  doc_creator UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transfer receipts are never deleted';
  END IF;
  SELECT "number", "created_by_id" INTO doc_number, doc_creator
    FROM "stock_documents" WHERE "id" = NEW."document_id";
  IF TG_OP = 'UPDATE' THEN
    IF NEW."document_id" <> OLD."document_id" OR NEW."transfer_id" <> OLD."transfer_id"
       OR NEW."location_id" <> OLD."location_id" THEN
      RAISE EXCEPTION 'stock document %: its transfer and location never change', doc_number;
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

CREATE TRIGGER "transfer_receipts_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "transfer_receipts"
  FOR EACH ROW EXECUTE FUNCTION "erp_transfer_receipt_guard"();

-- Accepted, returned and written off are each zero or more; only what arrived is accepted.
-- Whether they add up to what was dispatched is checked by the service on submission and again
-- inside the posting, against the transfer as it is then.
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_values"
  CHECK ("line_no" >= 1 AND "received" >= 0 AND "accepted" >= 0 AND "returned" >= 0
     AND "written_off" >= 0 AND "accepted" <= "received");
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_pieces"
  CHECK ((("received_pieces" IS NULL) = ("accepted_pieces" IS NULL))
     AND (("received_pieces" IS NULL) = ("returned_pieces" IS NULL))
     AND (("received_pieces" IS NULL) = ("written_off_pieces" IS NULL))
     AND ("received_pieces" IS NULL OR ("received_pieces" >= 0 AND "accepted_pieces" >= 0
          AND "returned_pieces" >= 0 AND "written_off_pieces" >= 0)));
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_temperature_range"
  CHECK ("temperature" IS NULL OR "temperature" BETWEEN -60 AND 60);
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_reason_length"
  CHECK ("reason" IS NULL OR length(btrim("reason")) BETWEEN 1 AND 500);

CREATE TRIGGER "transfer_receipt_lines_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "transfer_receipt_lines"
  FOR EACH ROW EXECUTE FUNCTION "erp_draft_only"();
