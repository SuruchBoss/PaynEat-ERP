-- A branch's own menu price can end (#16, ADR-0023 decision 4): a branch row without a price
-- means that from its effective-from date the branch charges the chain-wide price again. The
-- chain-wide price itself always has one.
ALTER TABLE "menu_prices" ALTER COLUMN "price" DROP NOT NULL;
ALTER TABLE "menu_prices" ADD CONSTRAINT "menu_prices_chain_price_set" CHECK ("price" IS NOT NULL OR "location_id" IS NOT NULL);
