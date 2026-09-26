// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
// Prisma 6 config files opt out of implicit .env loading; do it explicitly so
// `prisma migrate` behaves like the app does. (Adapted from Cwork, see NOTICE.)
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
});
