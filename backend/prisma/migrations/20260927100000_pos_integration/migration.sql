-- CreateEnum
CREATE TYPE "SalesEventStatus" AS ENUM ('received', 'processed', 'failed');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REVOKE';

-- CreateTable
CREATE TABLE "pos_instances" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_pull_at" TIMESTAMPTZ(3),

    CONSTRAINT "pos_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_instance_branches" (
    "pos_instance_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,

    CONSTRAINT "pos_instance_branches_pkey" PRIMARY KEY ("pos_instance_id","location_id")
);

-- CreateTable
CREATE TABLE "pos_credentials" (
    "id" UUID NOT NULL,
    "pos_instance_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "pos_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_events" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "pos_instance_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "sale_time" TIMESTAMPTZ(3) NOT NULL,
    "menu_item_code" TEXT NOT NULL,
    "quantity" DECIMAL(18,0),
    "weight_kg" DECIMAL(18,3),
    "modifiers" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" "SalesEventStatus" NOT NULL DEFAULT 'received',
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_instances_code_key" ON "pos_instances"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pos_credentials_token_hash_key" ON "pos_credentials"("token_hash");

-- CreateIndex
CREATE INDEX "pos_credentials_pos_instance_id_idx" ON "pos_credentials"("pos_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_events_idempotency_key_key" ON "sales_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "sales_events_location_id_sale_time_idx" ON "sales_events"("location_id", "sale_time");

-- CreateIndex
CREATE INDEX "sales_events_pos_instance_id_received_at_idx" ON "sales_events"("pos_instance_id", "received_at");

-- AddForeignKey
ALTER TABLE "pos_instances" ADD CONSTRAINT "pos_instances_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_instance_branches" ADD CONSTRAINT "pos_instance_branches_pos_instance_id_fkey" FOREIGN KEY ("pos_instance_id") REFERENCES "pos_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_instance_branches" ADD CONSTRAINT "pos_instance_branches_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_credentials" ADD CONSTRAINT "pos_credentials_pos_instance_id_fkey" FOREIGN KEY ("pos_instance_id") REFERENCES "pos_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_credentials" ADD CONSTRAINT "pos_credentials_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_credentials" ADD CONSTRAINT "pos_credentials_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_pos_instance_id_fkey" FOREIGN KEY ("pos_instance_id") REFERENCES "pos_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules the database keeps even if the application forgets them (#9, ADR-0002).
-- ---------------------------------------------------------------------------

ALTER TABLE "pos_instances" ADD CONSTRAINT "pos_instances_code_shape"
  CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{1,31}$');
ALTER TABLE "pos_instances" ADD CONSTRAINT "pos_instances_name_present"
  CHECK (length(btrim("name")) BETWEEN 1 AND 100);

-- At most one active credential per instance; a revocation records who and when, once.
CREATE UNIQUE INDEX "pos_credentials_one_active" ON "pos_credentials"("pos_instance_id")
  WHERE "revoked_at" IS NULL;
ALTER TABLE "pos_credentials" ADD CONSTRAINT "pos_credentials_revoked_complete"
  CHECK (("revoked_at" IS NULL) = ("revoked_by_id" IS NULL));

CREATE OR REPLACE FUNCTION "erp_pos_credential_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'POS credentials are never deleted; revoke them';
  END IF;
  IF OLD."revoked_at" IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked POS credential never changes';
  END IF;
  IF NEW."pos_instance_id" <> OLD."pos_instance_id" OR NEW."token_hash" <> OLD."token_hash"
     OR NEW."created_by_id" <> OLD."created_by_id" OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'a POS credential can only be revoked';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pos_credentials_guard"
  BEFORE UPDATE OR DELETE ON "pos_credentials"
  FOR EACH ROW EXECUTE FUNCTION "erp_pos_credential_guard"();

-- A sales event is a line sold by count or by weight, never both, never zero or less.
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_count_or_weight"
  CHECK (("quantity" IS NULL) <> ("weight_kg" IS NULL));
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_positive"
  CHECK (COALESCE("quantity", 1) > 0 AND COALESCE("weight_kg", 1) > 0);

-- Stored once and kept: only its processing status moves on (#17). Never deleted.
CREATE OR REPLACE FUNCTION "erp_sales_event_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales events are never deleted';
  END IF;
  IF (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'sales event %: only its status changes', OLD."idempotency_key";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_events_guard"
  BEFORE UPDATE OR DELETE ON "sales_events"
  FOR EACH ROW EXECUTE FUNCTION "erp_sales_event_guard"();
