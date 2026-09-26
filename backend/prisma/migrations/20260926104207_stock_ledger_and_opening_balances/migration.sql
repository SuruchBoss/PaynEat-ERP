-- CreateEnum
CREATE TYPE "StockDocumentType" AS ENUM ('opening_balance', 'reversal');

-- CreateEnum
CREATE TYPE "StockDocumentStatus" AS ENUM ('draft', 'posted');

-- CreateTable
CREATE TABLE "stock_documents" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" "StockDocumentType" NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'draft',
    "business_date" DATE NOT NULL,
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "posted_by_id" UUID,
    "posted_at" TIMESTAMPTZ(3),
    "reverses_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "origin_document_id" UUID NOT NULL,
    "origin_line_no" INTEGER NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "expiry_date" DATE NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "secondary_quantity" DECIMAL(18,0),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "secondary_quantity" DECIMAL(18,0),
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "business_time" TIMESTAMPTZ(3) NOT NULL,
    "posted_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL,
    "reverses_entry_id" UUID,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "lot_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "secondary_quantity" DECIMAL(18,0),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("lot_id","location_id")
);

-- CreateTable
CREATE TABLE "opening_balances" (
    "document_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,

    CONSTRAINT "opening_balances_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "opening_balance_lines" (
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "secondary_quantity" DECIMAL(18,0),
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "expiry_date" DATE NOT NULL,

    CONSTRAINT "opening_balance_lines_pkey" PRIMARY KEY ("document_id","line_no")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_number_key" ON "stock_documents"("number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_reverses_id_key" ON "stock_documents"("reverses_id");

-- CreateIndex
CREATE INDEX "stock_documents_type_status_idx" ON "stock_documents"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lots_number_key" ON "lots"("number");

-- CreateIndex
CREATE INDEX "lots_item_id_expiry_date_idx" ON "lots"("item_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "lots_id_item_id_key" ON "lots"("id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "lots_origin_document_id_origin_line_no_key" ON "lots"("origin_document_id", "origin_line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reverses_entry_id_key" ON "ledger_entries"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "ledger_entries_document_id_idx" ON "ledger_entries"("document_id");

-- CreateIndex
CREATE INDEX "ledger_entries_lot_id_location_id_idx" ON "ledger_entries"("lot_id", "location_id");

-- CreateIndex
CREATE INDEX "ledger_entries_location_id_business_time_idx" ON "ledger_entries"("location_id", "business_time");

-- CreateIndex
CREATE INDEX "ledger_entries_business_time_idx" ON "ledger_entries"("business_time");

-- CreateIndex
CREATE INDEX "stock_balances_location_id_item_id_idx" ON "stock_balances"("location_id", "item_id");

-- CreateIndex
CREATE INDEX "opening_balances_location_id_idx" ON "opening_balances"("location_id");

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_origin_document_id_fkey" FOREIGN KEY ("origin_document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_lot_id_item_id_fkey" FOREIGN KEY ("lot_id", "item_id") REFERENCES "lots"("id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_lot_id_item_id_fkey" FOREIGN KEY ("lot_id", "item_id") REFERENCES "lots"("id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "opening_balances"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules the database keeps even if the application forgets them (#7, ADR-0003).
-- ---------------------------------------------------------------------------

-- Document numbers come from core/sequence: two capital letters, the year, a counter.
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_number_format"
  CHECK ("number" ~ '^[A-Z]{2}-[0-9]{4}-[0-9]{5,}$');
-- Posted means posted by someone at some time; a draft has neither.
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_posted_complete"
  CHECK (("status" = 'posted' AND "posted_by_id" IS NOT NULL AND "posted_at" IS NOT NULL)
      OR ("status" = 'draft' AND "posted_by_id" IS NULL AND "posted_at" IS NULL));
-- A reversal names what it reverses, is posted the moment it exists, and never reverses itself.
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_reversal_shape"
  CHECK ((("type" = 'reversal') = ("reverses_id" IS NOT NULL))
     AND ("type" <> 'reversal' OR "status" = 'posted')
     AND ("reverses_id" IS NULL OR "reverses_id" <> "id"));
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_revision_positive"
  CHECK ("revision" >= 1);

-- A posted document never changes and no document is ever deleted: a mistake is corrected by
-- a reversal, and both stay visible. A draft may change, but never its type or number.
CREATE OR REPLACE FUNCTION "erp_stock_document_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock document %: documents are never deleted', OLD."number";
  END IF;
  IF OLD."status" = 'posted' THEN
    RAISE EXCEPTION 'stock document %: a posted document never changes; reverse it instead', OLD."number";
  END IF;
  IF NEW."type" <> OLD."type" OR NEW."number" <> OLD."number" OR NEW."created_by_id" <> OLD."created_by_id" THEN
    RAISE EXCEPTION 'stock document %: its type, number and creator never change', OLD."number";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_documents_guard"
  BEFORE UPDATE OR DELETE ON "stock_documents"
  FOR EACH ROW EXECUTE FUNCTION "erp_stock_document_guard"();

ALTER TABLE "lots" ADD CONSTRAINT "lots_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "lots" ADD CONSTRAINT "lots_unit_cost_not_negative" CHECK ("unit_cost" >= 0);
ALTER TABLE "lots" ADD CONSTRAINT "lots_secondary_quantity_positive"
  CHECK ("secondary_quantity" IS NULL OR "secondary_quantity" > 0);
ALTER TABLE "lots" ADD CONSTRAINT "lots_origin_line_positive" CHECK ("origin_line_no" >= 1);

-- A lot keeps its origin, cost and expiry for life (ADR-0004: no revaluation in v1).
CREATE TRIGGER "lots_append_only"
  BEFORE UPDATE OR DELETE ON "lots"
  FOR EACH ROW EXECUTE FUNCTION "erp_append_only"();

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_quantity_not_zero" CHECK ("quantity" <> 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_unit_cost_not_negative" CHECK ("unit_cost" >= 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_secondary_quantity_not_zero"
  CHECK ("secondary_quantity" IS NULL OR "secondary_quantity" <> 0);

-- Nothing updates or deletes a ledger entry, whoever asks (ADR-0003).
CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "erp_append_only"();

ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_line_positive" CHECK ("line_no" >= 1);
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_unit_cost_not_negative" CHECK ("unit_cost" >= 0);
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_secondary_quantity_positive"
  CHECK ("secondary_quantity" IS NULL OR "secondary_quantity" > 0);

-- An opening balance's location and lines change only while its document is a draft.
CREATE OR REPLACE FUNCTION "erp_draft_only"() RETURNS trigger AS $$
DECLARE
  doc_status "StockDocumentStatus";
  doc_number TEXT;
BEGIN
  SELECT "status", "number" INTO doc_status, doc_number FROM "stock_documents"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."document_id" ELSE NEW."document_id" END;
  IF doc_status = 'posted' THEN
    RAISE EXCEPTION 'stock document %: % is fixed once the document is posted', doc_number, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."document_id" <> OLD."document_id" THEN
    RAISE EXCEPTION '%: a row never moves to another document', TG_TABLE_NAME;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "opening_balances_draft_only"
  BEFORE UPDATE OR DELETE ON "opening_balances"
  FOR EACH ROW EXECUTE FUNCTION "erp_draft_only"();

CREATE TRIGGER "opening_balance_lines_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "opening_balance_lines"
  FOR EACH ROW EXECUTE FUNCTION "erp_draft_only"();

ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_next_value_positive" CHECK ("next_value" >= 1);
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_padding_range" CHECK ("padding" BETWEEN 1 AND 12);
