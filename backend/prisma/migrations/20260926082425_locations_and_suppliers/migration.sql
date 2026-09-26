-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('plant', 'warehouse', 'branch', 'in_transit', 'subcontractor');

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "origin_id" UUID,
    "superseded_by_id" UUID,
    "first_used_at" TIMESTAMPTZ(3),
    "first_use" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "master_data_version" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "locations_origin_id_key" ON "locations"("origin_id");

-- CreateIndex
CREATE INDEX "locations_type_idx" ON "locations"("type");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written from here on.

-- The ecosystem location code (docs/GLOSSARY.md, ADR-0011). An in-transit location is
-- the system's own: `IN-TRANSIT:` and its origin's code, a shape no person can type,
-- so it never takes a code a real site might need.
ALTER TABLE "locations" ADD CONSTRAINT "locations_code_format" CHECK (
  ("type" <> 'in_transit' AND "code" ~ '^[A-Z0-9][A-Z0-9-]{1,31}$')
  OR ("type" = 'in_transit' AND "code" ~ '^IN-TRANSIT:[A-Z0-9][A-Z0-9-]{1,31}$')
);
-- Exactly the in-transit locations have an origin.
ALTER TABLE "locations" ADD CONSTRAINT "locations_in_transit_has_origin" CHECK (("type" = 'in_transit') = ("origin_id" IS NOT NULL));
-- Reserved, not built in v1 (ADR-0001). A later migration drops this when it is.
ALTER TABLE "locations" ADD CONSTRAINT "locations_subcontractor_reserved" CHECK ("type" <> 'subcontractor');
-- A superseded location is out of use, and never its own replacement.
ALTER TABLE "locations" ADD CONSTRAINT "locations_superseded_is_inactive" CHECK ("superseded_by_id" IS NULL OR "active" = false);
ALTER TABLE "locations" ADD CONSTRAINT "locations_not_superseded_by_itself" CHECK ("superseded_by_id" IS NULL OR "superseded_by_id" <> "id");
ALTER TABLE "locations" ADD CONSTRAINT "locations_first_use_complete" CHECK (("first_used_at" IS NULL) = ("first_use" IS NULL));
-- Only branches are master data a POS pulls (#6); each carries its latest version.
ALTER TABLE "locations" ADD CONSTRAINT "locations_branch_versioned" CHECK (("type" = 'branch') = ("master_data_version" IS NOT NULL));
ALTER TABLE "locations" ADD CONSTRAINT "locations_revision_positive" CHECK ("revision" > 0);

-- Once other systems or documents rely on a code, nothing may change it — not even a
-- hand-written query. The API refuses first; this is the backstop. A location's type
-- never changes, and a first use is never forgotten.
CREATE OR REPLACE FUNCTION "erp_location_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."type" <> OLD."type" THEN
    RAISE EXCEPTION 'location %: the type of a location never changes', OLD."code";
  END IF;
  IF OLD."first_used_at" IS NOT NULL AND NEW."code" <> OLD."code" THEN
    RAISE EXCEPTION 'location %: the code is fixed since its first use (%)', OLD."code", OLD."first_use";
  END IF;
  IF OLD."first_used_at" IS NOT NULL AND NEW."first_used_at" IS DISTINCT FROM OLD."first_used_at" THEN
    RAISE EXCEPTION 'location %: its first use is never cleared or moved', OLD."code";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "locations_guard"
  BEFORE UPDATE ON "locations"
  FOR EACH ROW EXECUTE FUNCTION "erp_location_guard"();

-- Locations and suppliers are deactivated, never deleted: documents and the audit trail
-- keep pointing at them. TRUNCATE stays possible for the end-to-end suite.
CREATE OR REPLACE FUNCTION "erp_never_deleted"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are deactivated, never deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "locations_never_deleted"
  BEFORE DELETE ON "locations"
  FOR EACH ROW EXECUTE FUNCTION "erp_never_deleted"();

CREATE TRIGGER "suppliers_never_deleted"
  BEFORE DELETE ON "suppliers"
  FOR EACH ROW EXECUTE FUNCTION "erp_never_deleted"();

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{1,31}$');
-- The 13 digits; the check digit is verified by the API (a pure domain function).
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tax_id_format" CHECK ("tax_id" ~ '^[0-9]{13}$');
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_revision_positive" CHECK ("revision" > 0);
