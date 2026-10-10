-- Production BOMs, versioned by effective date, with expected yield and allocation ratios
-- (#12, ADR-0004, ADR-0023, ADR-0026).

-- CreateEnum
CREATE TYPE "BomSide" AS ENUM ('input', 'output');

-- CreateTable
CREATE TABLE "production_boms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "location_type" "LocationType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_bom_versions" (
    "id" UUID NOT NULL,
    "bom_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "ratios_overridden" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_bom_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_bom_lines" (
    "version_id" UUID NOT NULL,
    "side" "BomSide" NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "expected_weight_kg" DECIMAL(15,3),
    "allocation_ratio" DECIMAL(5,2),

    CONSTRAINT "production_bom_lines_pkey" PRIMARY KEY ("version_id","side","line_no")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_boms_code_key" ON "production_boms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "production_bom_versions_bom_id_effective_from_key" ON "production_bom_versions"("bom_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "production_bom_versions_bom_id_number_key" ON "production_bom_versions"("bom_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "production_bom_lines_version_id_item_id_key" ON "production_bom_lines"("version_id", "item_id");

-- AddForeignKey
ALTER TABLE "production_bom_versions" ADD CONSTRAINT "production_bom_versions_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "production_boms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_bom_lines" ADD CONSTRAINT "production_bom_lines_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "production_bom_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_bom_lines" ADD CONSTRAINT "production_bom_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The plant runs production in v1 (ADR-0026).
ALTER TABLE "production_boms" ADD CONSTRAINT "production_boms_plant_only"
  CHECK ("location_type" = 'plant');

ALTER TABLE "production_bom_versions" ADD CONSTRAINT "production_bom_versions_number_positive"
  CHECK ("number" >= 1);

-- Quantities and weights are above zero; only outputs carry a ratio, and every output does.
ALTER TABLE "production_bom_lines" ADD CONSTRAINT "production_bom_lines_line_no_positive"
  CHECK ("line_no" >= 1);
ALTER TABLE "production_bom_lines" ADD CONSTRAINT "production_bom_lines_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "production_bom_lines" ADD CONSTRAINT "production_bom_lines_weight_positive"
  CHECK ("expected_weight_kg" IS NULL OR "expected_weight_kg" > 0);
ALTER TABLE "production_bom_lines" ADD CONSTRAINT "production_bom_lines_ratio_on_outputs"
  CHECK (("side" = 'output') = ("allocation_ratio" IS NOT NULL));
ALTER TABLE "production_bom_lines" ADD CONSTRAINT "production_bom_lines_ratio_range"
  CHECK ("allocation_ratio" IS NULL OR ("allocation_ratio" > 0 AND "allocation_ratio" <= 100));
