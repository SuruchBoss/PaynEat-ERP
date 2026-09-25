-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_singleton_key" ON "companies"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "companies_code_key" ON "companies"("code");

-- Hand-written: one installation serves exactly one company (ADR-0001). With the
-- unique index above, this makes a second row impossible rather than merely unusual.
ALTER TABLE "companies" ADD CONSTRAINT "companies_singleton_true" CHECK ("singleton");
