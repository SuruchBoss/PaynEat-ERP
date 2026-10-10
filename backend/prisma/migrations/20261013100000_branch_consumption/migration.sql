-- Copyright 2026 Suruch Chakrapeesirisuk
-- SPDX-License-Identifier: Apache-2.0

-- #17: branch consumption from POS sales events (ADR-0030). Each sales event becomes one
-- branch-consumption document; placeholder lots stand in where a branch never held an item; the
-- automatic account posts what no person did; every attempt is recorded and kept.

-- CreateEnum
CREATE TYPE "SalesEventOutcome" AS ENUM ('processed', 'failed', 'held', 'reprocessed');

-- CreateEnum
CREATE TYPE "PlaceholderCost" AS ENUM ('estimated', 'unknown');

-- AlterEnum
ALTER TYPE "StockDocumentType" ADD VALUE 'branch_consumption';


-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "sale_time_ahead_tolerance_minutes" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "lots" ADD COLUMN     "placeholder_cost" "PlaceholderCost",
ADD COLUMN     "placeholder_location_id" UUID,
ALTER COLUMN "expiry_date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "system" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "branch_consumptions" (
    "document_id" UUID NOT NULL,
    "sales_event_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "sale_time" TIMESTAMPTZ(3) NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "recipe_effective_from" DATE NOT NULL,
    "shortfall" BOOLEAN NOT NULL DEFAULT false,
    "consumed_expired_lot" BOOLEAN NOT NULL DEFAULT false,
    "placeholder" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_consumptions_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "branch_consumption_lines" (
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "usage" DECIMAL(18,6) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "branch_consumption_lines_pkey" PRIMARY KEY ("document_id","line_no")
);

-- CreateTable
CREATE TABLE "sales_event_processing" (
    "id" UUID NOT NULL,
    "sales_event_id" UUID NOT NULL,
    "outcome" "SalesEventOutcome" NOT NULL,
    "reason" TEXT,
    "detail" JSONB,
    "document_id" UUID,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_event_processing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_consumptions_sales_event_id_key" ON "branch_consumptions"("sales_event_id");

-- CreateIndex
CREATE INDEX "branch_consumptions_location_id_sale_time_idx" ON "branch_consumptions"("location_id", "sale_time");

-- CreateIndex
CREATE UNIQUE INDEX "branch_consumption_lines_document_id_item_id_key" ON "branch_consumption_lines"("document_id", "item_id");

-- CreateIndex
CREATE INDEX "sales_event_processing_sales_event_id_recorded_at_idx" ON "sales_event_processing"("sales_event_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "lots_placeholder_location_id_item_id_key" ON "lots"("placeholder_location_id", "item_id");

-- CreateIndex
CREATE INDEX "sales_events_status_received_at_idx" ON "sales_events"("status", "received_at");

-- AddForeignKey
ALTER TABLE "branch_consumptions" ADD CONSTRAINT "branch_consumptions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_consumptions" ADD CONSTRAINT "branch_consumptions_sales_event_id_fkey" FOREIGN KEY ("sales_event_id") REFERENCES "sales_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_consumptions" ADD CONSTRAINT "branch_consumptions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_consumptions" ADD CONSTRAINT "branch_consumptions_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_consumption_lines" ADD CONSTRAINT "branch_consumption_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "branch_consumptions"("document_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_consumption_lines" ADD CONSTRAINT "branch_consumption_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_event_processing" ADD CONSTRAINT "sales_event_processing_sales_event_id_fkey" FOREIGN KEY ("sales_event_id") REFERENCES "sales_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_event_processing" ADD CONSTRAINT "sales_event_processing_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_event_processing" ADD CONSTRAINT "sales_event_processing_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_placeholder_location_id_fkey" FOREIGN KEY ("placeholder_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Lots ------------------------------------------------------------------------------------------

-- A placeholder lot is created holding nothing; every other lot is created holding something.
ALTER TABLE "lots" DROP CONSTRAINT "lots_quantity_positive";
ALTER TABLE "lots" ADD CONSTRAINT "lots_quantity_positive"
  CHECK ("quantity" > 0 OR ("placeholder_location_id" IS NOT NULL AND "quantity" = 0));

-- A placeholder lot, and only a placeholder lot, has no expiry and says what its cost is.
ALTER TABLE "lots" ADD CONSTRAINT "lots_placeholder_shape"
  CHECK (("placeholder_location_id" IS NULL) = ("expiry_date" IS NOT NULL)
     AND ("placeholder_location_id" IS NULL) = ("placeholder_cost" IS NULL)
     AND ("placeholder_location_id" IS NULL OR "secondary_quantity" IS NULL));

-- "No cost known" is a cost of 0, never a number someone could take for a real one.
ALTER TABLE "lots" ADD CONSTRAINT "lots_placeholder_unknown_cost"
  CHECK ("placeholder_cost" IS DISTINCT FROM 'unknown' OR "unit_cost" = 0);

-- The automatic account ----------------------------------------------------------------------

-- It holds no usable password (`!` is never a valid hash), no second factor, and is no demo account.
ALTER TABLE "users" ADD CONSTRAINT "users_system_unusable"
  CHECK (NOT "system" OR ("password_hash" = '!' AND NOT "mfa_enabled" AND NOT "demo"));

-- There is one.
CREATE UNIQUE INDEX "users_one_system_account" ON "users" ("system") WHERE "system";

-- An account never becomes, or stops being, the automatic one.
CREATE OR REPLACE FUNCTION "erp_user_system_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."system" <> OLD."system" THEN
    RAISE EXCEPTION 'user %: whether an account is the automatic one never changes', OLD."email";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_system_guard"
  BEFORE UPDATE OF "system" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "erp_user_system_guard"();

-- It never holds a role and never has a session, whatever code path asks.
CREATE OR REPLACE FUNCTION "erp_system_user_refused"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."user_id" AND "system") THEN
    RAISE EXCEPTION 'the automatic account never holds a role or signs in (%)', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_roles_not_system"
  BEFORE INSERT OR UPDATE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION "erp_system_user_refused"();

CREATE TRIGGER "sessions_not_system"
  BEFORE INSERT OR UPDATE ON "sessions"
  FOR EACH ROW EXECUTE FUNCTION "erp_system_user_refused"();

INSERT INTO "users" ("id", "email", "display_name", "password_hash", "system", "updated_at")
VALUES (gen_random_uuid(), 'automatic@payneat-erp.invalid', 'PaynEat ERP — automatic', '!', true, now())
ON CONFLICT DO NOTHING;

-- Branch consumption -------------------------------------------------------------------------

ALTER TABLE "branch_consumption_lines" ADD CONSTRAINT "branch_consumption_lines_line_positive"
  CHECK ("line_no" >= 1);
ALTER TABLE "branch_consumption_lines" ADD CONSTRAINT "branch_consumption_lines_quantity_positive"
  CHECK ("usage" > 0 AND "quantity" > 0);

-- A consumption and its lines are fixed once its document is posted.
CREATE TRIGGER "branch_consumptions_draft_only"
  BEFORE UPDATE OR DELETE ON "branch_consumptions"
  FOR EACH ROW EXECUTE FUNCTION "erp_draft_only"();

CREATE TRIGGER "branch_consumption_lines_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "branch_consumption_lines"
  FOR EACH ROW EXECUTE FUNCTION "erp_draft_only"();

-- The record of attempts is kept as it happened.
ALTER TABLE "sales_event_processing" ADD CONSTRAINT "sales_event_processing_shape"
  CHECK (("outcome" IN ('failed', 'held')) = ("reason" IS NOT NULL)
     AND ("outcome" = 'processed') = ("document_id" IS NOT NULL));

CREATE TRIGGER "sales_event_processing_append_only"
  BEFORE UPDATE OR DELETE ON "sales_event_processing"
  FOR EACH ROW EXECUTE FUNCTION "erp_append_only"();

-- A sales event becomes processed only with its consumption posted, and stays processed.
CREATE OR REPLACE FUNCTION "erp_sales_event_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales events are never deleted';
  END IF;
  IF (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'sales event %: only its status changes', OLD."idempotency_key";
  END IF;
  IF OLD."status" = 'processed' AND NEW."status" <> 'processed' THEN
    RAISE EXCEPTION 'sales event %: a processed event stays processed', OLD."idempotency_key";
  END IF;
  IF NEW."status" = 'processed' AND OLD."status" <> 'processed' AND NOT EXISTS (
       SELECT 1 FROM "branch_consumptions" c
       JOIN "stock_documents" d ON d."id" = c."document_id"
       WHERE c."sales_event_id" = NEW."id" AND d."status" = 'posted') THEN
    RAISE EXCEPTION 'sales event %: processed only once its consumption is posted', OLD."idempotency_key";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
