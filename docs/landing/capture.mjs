// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0
//
// Captures the landing page's screenshots from the console's demo build (ADR-0021), in English and
// Thai, and writes them as WebP to docs/landing/img/. Every picture is the real console on the
// fictional chain's data; nothing is mocked up.
//
//   cd web && VITE_ERP_DEMO=1 VITE_BASE_PATH=/ npm run build && npx vite preview --port 4174 --strictPort &
//   NODE_PATH="$(npm root -g)" node docs/landing/capture.mjs      # needs a global `playwright`
//
// Each flow runs once in English; the console's own language switch then redraws the same state in
// Thai, because a reload would start the demo from its seed again.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:4174';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'img');
const PASSWORD = 'demo-chicken-2026'; // published demo password (README, "Demo accounts")
const RECOVERY_CODE = 'DEMOC-HICKE-NRCVR-YAAA2'; // published; each demo visit restores it
const DESKTOP = { viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const WIDTH = { desktop: 1600, phone: 780 };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const encoder = await browser.newPage();

/** PNG → WebP at the landing page's width, encoded by the browser itself: no image library needed. */
async function writeWebp(png, name, width) {
  const dataUrl = await encoder.evaluate(
    async ([b64, target]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = target;
      canvas.height = Math.round((img.height * target) / img.width);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', 0.86);
    },
    [png.toString('base64'), width],
  );
  writeFileSync(join(OUT, `${name}.webp`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`docs/landing/img/${name}.webp`);
}

async function open(options, { dark = false } = {}) {
  const context = await browser.newContext({ ...options, colorScheme: dark ? 'dark' : 'light' });
  await context.addInitScript(() => window.localStorage.setItem('payneat-erp.language', 'en'));
  const page = await context.newPage();
  page.kind = options === PHONE ? 'phone' : 'desktop';
  return page;
}

async function signIn(page, account) {
  await page.goto(`${BASE}/sign-in`);
  await page.fill('#sign-in-email', `${account}@demo-chicken.example`);
  await page.fill('#sign-in-password', PASSWORD);
  await page.keyboard.press('Enter');
  if (account === 'admin') {
    await page.waitForSelector('#sign-in-code');
    await page.fill('#sign-in-code', RECOVERY_CODE);
    await page.keyboard.press('Enter');
  }
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 15000 });
}

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

/** The same screen in English, then in Thai through the console's language switch, then back. */
async function both(page, scene) {
  await settle(page);
  await writeWebp(await page.screenshot(), `en-${scene}`, WIDTH[page.kind]);
  await page.getByRole('button', { name: 'ไทย', exact: true }).click();
  await settle(page);
  await writeWebp(await page.screenshot(), `th-${scene}`, WIDTH[page.kind]);
  await page.getByRole('button', { name: 'English', exact: true }).click();
}

async function choose(page, selector, text) {
  await page.waitForFunction((sel) => document.querySelector(sel)?.options.length > 1, selector);
  const options = await page.$eval(selector, (el) => [...el.options].map((o) => [o.value, o.textContent]));
  await page.selectOption(selector, options.find(([, label]) => label.includes(text))[0]);
}

// Administrator: the second factor, then the screens most chains ask about first.
{
  const page = await open(DESKTOP);
  await page.goto(`${BASE}/sign-in`);
  await page.fill('#sign-in-email', 'admin@demo-chicken.example');
  await page.fill('#sign-in-password', PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#sign-in-code');
  await both(page, 'second-factor');
  await page.fill('#sign-in-code', RECOVERY_CODE);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.includes('sign-in'));
  for (const [path, scene] of [
    ['/', 'status'],
    ['/stock', 'stock'],
    ['/items', 'items'],
    ['/locations', 'locations'],
    ['/users', 'users'],
  ]) {
    await page.goto(`${BASE}${path}`);
    await both(page, scene);
  }
  await page.context().close();
}

// The stock on hand in dark mode, for the page's opening picture.
{
  const page = await open(DESKTOP, { dark: true });
  await signIn(page, 'finance');
  await page.goto(`${BASE}/stock`);
  await both(page, 'stock-dark');
  await page.context().close();
}

// Plant: an opening balance refused line by line, then posted and corrected only by a reversal.
{
  const page = await open(DESKTOP);
  await signIn(page, 'plant');
  await page.goto(`${BASE}/opening-balances`);
  await page.getByRole('button', { name: 'New opening balance' }).click();
  await choose(page, '#ob-location', 'BR-ARI');
  await choose(page, '#ob-item-1', 'CHICKEN-DRUMSTICK');
  await page.fill('#ob-quantity-1', '2.5');
  await page.fill('#ob-cost-1', '14.5');
  const expiry = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await page.fill('#ob-expiry-1', expiry);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByText('Line 1:').waitFor();
  await both(page, 'opening-refused');

  await page.fill('#ob-quantity-1', '25');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'Post this document' }).click();
  await page.getByRole('button', { name: 'Yes, post it' }).click();
  await page.getByRole('button', { name: 'Reverse this document' }).click();
  await page.fill('#reverse-note', 'Counted at the wrong branch');
  await page.getByRole('button', { name: 'Yes, reverse it' }).click();
  await page.getByText('RV-2026-00001').first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await both(page, 'opening-reversed');
  await page.context().close();
}

// Purchasing: a supplier whose tax identification number has a mistyped digit.
{
  const page = await open(DESKTOP);
  await signIn(page, 'purchasing');
  await page.goto(`${BASE}/suppliers`);
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await page.fill('#supplier-code', 'SUP-PACK');
  await page.fill('#supplier-name', 'บริษัท บรรจุภัณฑ์เดโม จำกัด (สมมติ) · Demo Packaging Co., Ltd. (fictional)');
  await page.fill('#supplier-tax-id', '0-1055-61234-56-7');
  await page.getByRole('button', { name: 'Create supplier' }).click();
  await page.waitForTimeout(800);
  await both(page, 'supplier-tax-id');
  await page.context().close();
}

// Phone: tables become cards; light and dark.
for (const dark of [false, true]) {
  const page = await open(PHONE, { dark });
  await signIn(page, 'finance');
  await page.goto(`${BASE}/stock`);
  await both(page, dark ? 'phone-stock-dark' : 'phone-stock');
  await page.context().close();
}

await browser.close();
