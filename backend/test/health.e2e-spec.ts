// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { DEMO_COMPANY } from '../prisma/seed';
import { createTestApp, TestContext } from './utils/test-app';

describe('GET /health', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('reports the API and the database as up', async () => {
    const res = await request(ctx.server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', api: 'up', database: 'up' });
  });

  it('lives outside the API prefix and version', async () => {
    expect((await request(ctx.server).get('/api/v1/health')).status).toBe(404);
  });
});

describe('the demo seed', () => {
  it('has built the fictional chain the suite runs against', async () => {
    const prisma = new PrismaClient();
    try {
      const companies = await prisma.company.findMany();
      expect(companies).toHaveLength(1);
      expect(companies[0]).toMatchObject(DEMO_COMPANY);
    } finally {
      await prisma.$disconnect();
    }
  });
});
