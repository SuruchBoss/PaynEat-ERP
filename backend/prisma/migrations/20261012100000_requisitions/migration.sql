-- Copyright 2026 Suruch Chakrapeesirisuk
-- SPDX-License-Identifier: Apache-2.0

-- Branch requisitions and par levels (#15, ADR-0009, ADR-0029). A requisition writes no stock;
-- transfers created from it fulfil it, and how far is read from what they dispatched.

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('draft', 'submitted', 'cancelled');

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "requisition_unit" DECIMAL(18,3);

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN     "requisition_id" UUID;

-- CreateTable
CREATE TABLE "par_levels" (
    "location_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "par_levels_pkey" PRIMARY KEY ("location_id","item_id")
);

-- CreateTable
CREATE TABLE "requisitions" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'draft',
    "branch_id" UUID NOT NULL,
    "supplying_location_id" UUID NOT NULL,
    "needed_by" DATE NOT NULL,
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,

    CONSTRAINT "requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisition_lines" (
    "requisition_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "suggested" DECIMAL(18,3),
    "requested" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "requisition_lines_pkey" PRIMARY KEY ("requisition_id","line_no")
);

-- CreateIndex
CREATE INDEX "par_levels_item_id_idx" ON "par_levels"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "requisitions_number_key" ON "requisitions"("number");

-- CreateIndex
CREATE INDEX "requisitions_branch_id_idx" ON "requisitions"("branch_id");

-- CreateIndex
CREATE INDEX "requisitions_status_idx" ON "requisitions"("status");

-- CreateIndex
CREATE INDEX "requisition_lines_item_id_idx" ON "requisition_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "requisition_lines_requisition_id_item_id_key" ON "requisition_lines"("requisition_id", "item_id");

-- CreateIndex
CREATE INDEX "transfers_requisition_id_idx" ON "transfers"("requisition_id");

-- AddForeignKey
ALTER TABLE "par_levels" ADD CONSTRAINT "par_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "par_levels" ADD CONSTRAINT "par_levels_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "par_levels" ADD CONSTRAINT "par_levels_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_supplying_location_id_fkey" FOREIGN KEY ("supplying_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Par levels and requisition units are quantities in the item's base unit.
ALTER TABLE "par_levels" ADD CONSTRAINT "par_levels_quantity_not_negative" CHECK ("quantity" >= 0);
ALTER TABLE "items" ADD CONSTRAINT "items_requisition_unit_positive"
  CHECK ("requisition_unit" IS NULL OR "requisition_unit" > 0);

ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_values"
  CHECK ("line_no" >= 1 AND "requested" > 0 AND ("suggested" IS NULL OR "suggested" >= 0));
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_branch_is_not_supplier"
  CHECK ("branch_id" <> "supplying_location_id");
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_submitted_has_submitter"
  CHECK ("status" = 'draft' OR "status" = 'cancelled' OR "submitted_by_id" IS NOT NULL);
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_cancelled_has_reason"
  CHECK (("status" = 'cancelled') = ("cancelled_by_id" IS NOT NULL AND "cancellation_reason" IS NOT NULL));

-- A requisition is never deleted. Its number, branch and supplying location never change; it
-- moves draft -> submitted, or to cancelled from draft or submitted, and a submission or a
-- cancellation never changes once made. It is not cancelled once a transfer of it was dispatched
-- and not reversed: that stock is on its way.
CREATE OR REPLACE FUNCTION "erp_requisition_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'requisitions are never deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."number" <> OLD."number" OR NEW."branch_id" <> OLD."branch_id"
       OR NEW."supplying_location_id" <> OLD."supplying_location_id" THEN
      RAISE EXCEPTION 'requisition %: its number, branch and supplying location never change', OLD."number";
    END IF;
    IF NEW."status" <> OLD."status" AND NOT (
         (OLD."status" = 'draft' AND NEW."status" IN ('submitted', 'cancelled'))
      OR (OLD."status" = 'submitted' AND NEW."status" = 'cancelled')) THEN
      RAISE EXCEPTION 'requisition %: it cannot move from % to %', OLD."number", OLD."status", NEW."status";
    END IF;
    IF OLD."status" <> 'draft' AND (NEW."needed_by" <> OLD."needed_by"
       OR NEW."note" IS DISTINCT FROM OLD."note") THEN
      RAISE EXCEPTION 'requisition %: only a draft is edited', OLD."number";
    END IF;
    IF OLD."submitted_by_id" IS NOT NULL AND (
         NEW."submitted_by_id" IS DISTINCT FROM OLD."submitted_by_id"
      OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at") THEN
      RAISE EXCEPTION 'requisition %: a submission never changes', OLD."number";
    END IF;
    IF OLD."status" = 'cancelled' AND (
         NEW."cancelled_by_id" IS DISTINCT FROM OLD."cancelled_by_id"
      OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
      OR NEW."cancellation_reason" IS DISTINCT FROM OLD."cancellation_reason") THEN
      RAISE EXCEPTION 'requisition %: a cancellation never changes', OLD."number";
    END IF;
    IF NEW."status" = 'cancelled' AND OLD."status" <> 'cancelled' AND EXISTS (
         SELECT 1 FROM "transfers" t
         JOIN "stock_documents" d ON d."id" = t."document_id"
         WHERE t."requisition_id" = NEW."id" AND d."status" = 'posted'
           AND NOT EXISTS (SELECT 1 FROM "stock_documents" r WHERE r."reverses_id" = d."id")) THEN
      RAISE EXCEPTION 'requisition %: stock was dispatched against it, so it is not cancelled', OLD."number";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "requisitions_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "requisitions"
  FOR EACH ROW EXECUTE FUNCTION "erp_requisition_guard"();

-- A requisition's lines change only while it is a draft.
CREATE OR REPLACE FUNCTION "erp_requisition_draft_only"() RETURNS trigger AS $$
DECLARE
  req_status TEXT;
  req_number TEXT;
BEGIN
  SELECT "status"::text, "number" INTO req_status, req_number FROM "requisitions"
    WHERE "id" = COALESCE(NEW."requisition_id", OLD."requisition_id");
  IF req_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'requisition %: its lines change only while it is a draft', req_number;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "requisition_lines_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "requisition_lines"
  FOR EACH ROW EXECUTE FUNCTION "erp_requisition_draft_only"();

-- A transfer created from a requisition goes from its supplying location to its branch, from a
-- requisition logistics may fulfil, and keeps that link for good.
CREATE OR REPLACE FUNCTION "erp_transfer_requisition_guard"() RETURNS trigger AS $$
DECLARE
  req RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."requisition_id" IS DISTINCT FROM OLD."requisition_id" THEN
    RAISE EXCEPTION 'a transfer keeps the requisition it was created from';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."requisition_id" IS NOT NULL THEN
    SELECT "number", "status"::text AS status, "branch_id", "supplying_location_id" INTO req
      FROM "requisitions" WHERE "id" = NEW."requisition_id";
    IF req.status <> 'submitted' THEN
      RAISE EXCEPTION 'requisition %: only a submitted requisition is fulfilled', req.number;
    END IF;
    IF NEW."origin_id" <> req."supplying_location_id" OR NEW."destination_id" <> req."branch_id" THEN
      RAISE EXCEPTION 'requisition %: its transfers go from its supplying location to its branch', req.number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "transfers_requisition_guard"
  BEFORE INSERT OR UPDATE OF "requisition_id" ON "transfers"
  FOR EACH ROW EXECUTE FUNCTION "erp_transfer_requisition_guard"();
