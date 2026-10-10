-- Copyright 2026 Suruch Chakrapeesirisuk
-- SPDX-License-Identifier: Apache-2.0

-- #15: a transfer created from a requisition and the requisition's cancellation queue on the
-- requisition's row, so a cancellation never slips past a transfer being created at the same
-- time; a requisition is not cancelled while a transfer of it is still a draft either; and a
-- transfer created from a requisition keeps its route for good, not only when it is inserted.

CREATE OR REPLACE FUNCTION "erp_transfer_requisition_guard"() RETURNS trigger AS $$
DECLARE
  req RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."requisition_id" IS DISTINCT FROM OLD."requisition_id" THEN
    RAISE EXCEPTION 'a transfer keeps the requisition it was created from';
  END IF;
  IF NEW."requisition_id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."origin_id" = OLD."origin_id"
     AND NEW."destination_id" = OLD."destination_id" THEN
    RETURN NEW;
  END IF;
  SELECT "number", "status"::text AS status, "branch_id", "supplying_location_id" INTO req
    FROM "requisitions" WHERE "id" = NEW."requisition_id" FOR SHARE;
  IF TG_OP = 'INSERT' AND req.status <> 'submitted' THEN
    RAISE EXCEPTION 'requisition %: only a submitted requisition is fulfilled', req.number;
  END IF;
  IF NEW."origin_id" <> req."supplying_location_id" OR NEW."destination_id" <> req."branch_id" THEN
    RAISE EXCEPTION 'requisition %: its transfers go from its supplying location to its branch', req.number;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "transfers_requisition_guard" ON "transfers";
CREATE TRIGGER "transfers_requisition_guard"
  BEFORE INSERT OR UPDATE OF "requisition_id", "origin_id", "destination_id" ON "transfers"
  FOR EACH ROW EXECUTE FUNCTION "erp_transfer_requisition_guard"();

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
         WHERE t."requisition_id" = NEW."id"
           AND (d."status" = 'draft' OR (d."status" = 'posted'
             AND NOT EXISTS (SELECT 1 FROM "stock_documents" r WHERE r."reverses_id" = d."id")))) THEN
      RAISE EXCEPTION 'requisition %: a transfer of it is a draft or dispatched, so it is not cancelled', OLD."number";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
