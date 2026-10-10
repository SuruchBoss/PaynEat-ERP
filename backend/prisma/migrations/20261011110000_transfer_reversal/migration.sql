-- Copyright 2026 Suruch Chakrapeesirisuk
-- SPDX-License-Identifier: Apache-2.0

-- Transfers (#14, ADR-0028), after review: logistics reverses a dispatch while no receipt of it
-- has posted, through the ledger's reversal (#7), and nobody approves a transfer receipt they
-- created or submitted. The service refuses both inside the transaction that locks the transfer;
-- the database refuses them again.

-- A transfer whose dispatch was reversed is never received.
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
    IF NEW."receipt_document_id" IS NOT NULL AND OLD."receipt_document_id" IS NULL
       AND EXISTS (SELECT 1 FROM "stock_documents" WHERE "reverses_id" = NEW."document_id") THEN
      RAISE EXCEPTION 'transfer %: its dispatch was reversed, so it is never received', doc_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Nobody approves a transfer receipt they created or submitted.
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
  IF NEW."approved_by_id" IS NOT NULL
     AND (NEW."approved_by_id" = doc_creator OR NEW."approved_by_id" = NEW."submitted_by_id") THEN
    RAISE EXCEPTION 'stock document %: nobody approves a receipt they created or submitted (ADR-0008, ADR-0028)', doc_number;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
