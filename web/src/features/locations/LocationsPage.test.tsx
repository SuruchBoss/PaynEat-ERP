// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import {
  ADMIN,
  axeViolations,
  jsonResponse,
  mockApi,
  renderApp,
  sentBody,
  STAFF,
} from '@/test/render';
import type { LocationView } from './locations.api';

const location = (overrides: Partial<LocationView>): LocationView => ({
  id: '00000000-0000-4000-8000-000000000000',
  code: 'X',
  type: 'branch',
  nameTh: 'ที่',
  nameEn: 'Place',
  active: true,
  origin: null,
  inTransit: null,
  supersededBy: null,
  firstUsedAt: null,
  firstUse: null,
  revision: 1,
  masterDataVersion: null,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  ...overrides,
});

const PLANT = location({
  id: '00000000-0000-4000-8000-00000000000a',
  code: 'PLANT-01',
  type: 'plant',
  nameTh: 'โรงงานบางนา',
  nameEn: 'Bang Na plant',
  inTransit: { id: '00000000-0000-4000-8000-00000000000b', code: 'IN-TRANSIT:PLANT-01' },
});
const TRANSIT = location({
  id: '00000000-0000-4000-8000-00000000000b',
  code: 'IN-TRANSIT:PLANT-01',
  type: 'in_transit',
  nameTh: 'ระหว่างขนส่งจาก โรงงานบางนา',
  nameEn: 'In transit from Bang Na plant',
  origin: { id: PLANT.id, code: 'PLANT-01' },
});
const SILOM = location({
  id: '00000000-0000-4000-8000-00000000000c',
  code: 'BR-SILOM',
  nameTh: 'สาขาสีลม',
  nameEn: 'Silom branch',
  firstUsedAt: '2026-09-26T01:00:00.000Z',
  firstUse: 'goods receipt GR-000001',
  revision: 3,
  masterDataVersion: 7,
});
const ARI = location({
  id: '00000000-0000-4000-8000-00000000000d',
  code: 'BR-ARI',
  nameTh: 'สาขาอารีย์',
  nameEn: 'Ari branch',
  masterDataVersion: 8,
});
const OLD = location({
  id: '00000000-0000-4000-8000-00000000000e',
  code: 'BR-SILOMM',
  nameTh: 'สาขาสีลม (รหัสผิด)',
  nameEn: 'Silom (wrong code)',
  active: false,
  supersededBy: { id: SILOM.id, code: 'BR-SILOM' },
});

const rowOf = (name: string) => {
  const row = screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
};

const catalogue = (all: () => LocationView[]) => ({
  'GET /locations': () => jsonResponse(200, all()),
});

describe('locations', () => {
  it('lists locations with their type, code state and in-transit origin, and passes axe in both languages', async () => {
    mockApi(catalogue(() => [PLANT, TRANSIT, SILOM, ARI, OLD]));
    const view = renderApp('/locations', { as: STAFF });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'สถานที่เก็บสต๊อก' }),
    ).toBeVisible();
    await screen.findByText('โรงงานบางนา');
    expect(rowOf('^โรงงานบางนา').getByText('แก้รหัสได้จนกว่าจะใช้งาน')).toBeVisible();
    expect(rowOf('สาขาสีลม').getByText('ใช้งานแล้ว รหัสเปลี่ยนไม่ได้')).toBeVisible();
    expect(rowOf('ระหว่างขนส่งจาก').getByText('ของ PLANT-01')).toBeVisible();
    expect(rowOf('ระหว่างขนส่งจาก').getByText('ระบบจัดการเอง')).toBeVisible();
    // Superseded and inactive: kept, but shown only when asked for.
    expect(screen.queryByText('สาขาสีลม (รหัสผิด)')).not.toBeInTheDocument();
    // Anyone signed in reads; only location:manage changes.
    expect(screen.queryByRole('button', { name: 'เพิ่มสถานที่' })).not.toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);

    view.unmount();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/locations', { as: STAFF });
    await screen.findByText('Bang Na plant');
    const u = userEvent.setup();
    await u.selectOptions(screen.getByLabelText('Show'), 'inactive');
    expect(rowOf('Silom \\(wrong code\\)').getByText('Superseded by BR-SILOM')).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('filters by type', async () => {
    mockApi(catalogue(() => [PLANT, TRANSIT, SILOM, ARI]));
    renderApp('/locations', { as: STAFF });
    await screen.findByText('โรงงานบางนา');
    await userEvent.setup().selectOptions(screen.getByLabelText('ประเภท'), 'branch');
    expect(screen.getByText('2 แห่ง')).toBeVisible();
    expect(screen.queryByText('โรงงานบางนา')).not.toBeInTheDocument();
  });

  it('creates a plant and says its in-transit location came with it', async () => {
    let created: LocationView | null = null;
    const api = mockApi({
      ...catalogue(() => (created ? [PLANT, created] : [PLANT])),
      'POST /locations': (init) => {
        const body = JSON.parse(String(init.body)) as LocationView;
        created = location({
          ...body,
          id: '00000000-0000-4000-8000-00000000000f',
          inTransit: {
            id: '00000000-0000-4000-8000-000000000010',
            code: `IN-TRANSIT:${body.code}`,
          },
        });
        return jsonResponse(201, created);
      },
    });
    renderApp('/locations', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เพิ่มสถานที่' }));
    const form = screen.getByRole('form', { name: 'สถานที่ใหม่' });
    await u.type(within(form).getByLabelText('รหัสสถานที่'), 'wh-01');
    await u.selectOptions(within(form).getByLabelText('ประเภท'), 'warehouse');
    await u.type(within(form).getByLabelText('ชื่อภาษาไทย'), 'คลังกลาง');
    await u.type(within(form).getByLabelText('ชื่อภาษาอังกฤษ'), 'Central store');
    expect(await axeViolations()).toEqual([]);
    await u.click(within(form).getByRole('button', { name: 'สร้างสถานที่' }));

    expect(
      await screen.findByText('สร้าง WH-01 แล้ว พร้อมสถานที่ระหว่างขนส่ง IN-TRANSIT:WH-01'),
    ).toBeVisible();
    const post = api.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(api, post)).toEqual({
      code: 'WH-01',
      type: 'warehouse',
      nameTh: 'คลังกลาง',
      nameEn: 'Central store',
    });
  });

  it('explains a code in the wrong shape', async () => {
    mockApi({
      ...catalogue(() => [PLANT]),
      'POST /locations': () =>
        jsonResponse(422, {
          code: 'INVALID_LOCATION_CODE',
          message: 'x',
          details: { problem: 'BAD_CHARACTER' },
        }),
    });
    renderApp('/locations', { as: ADMIN });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'เพิ่มสถานที่' }));
    const form = screen.getByRole('form', { name: 'สถานที่ใหม่' });
    await u.type(within(form).getByLabelText('รหัสสถานที่'), 'BR SILOM');
    await u.type(within(form).getByLabelText('ชื่อภาษาไทย'), 'x');
    await u.type(within(form).getByLabelText('ชื่อภาษาอังกฤษ'), 'x');
    await u.click(within(form).getByRole('button', { name: 'สร้างสถานที่' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'รหัสสถานที่ต้องเป็นตัวอักษรพิมพ์ใหญ่ ตัวเลข และขีด 2–32 ตัว',
    );
  });

  it('corrects a code that is not in use yet, from the revision it was opened at', async () => {
    let current = ARI;
    const api = mockApi({
      ...catalogue(() => [current]),
      [`PATCH /locations/${ARI.id}`]: (init) => {
        const body = JSON.parse(String(init.body)) as Partial<LocationView>;
        current = { ...current, ...body, revision: 2 };
        return jsonResponse(200, current);
      },
    });
    renderApp('/locations', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'แก้ไข สาขาอารีย์' }));
    const form = screen.getByRole('form', { name: 'แก้ไข BR-ARI' });
    const code = within(form).getByLabelText('รหัสสถานที่');
    expect(code).not.toHaveAttribute('readonly');
    await u.clear(code);
    await u.type(code, 'br-ari-1');
    await u.click(within(form).getByRole('button', { name: 'บันทึกการแก้ไข' }));

    expect(await screen.findByText('บันทึก BR-ARI-1 แล้ว')).toBeVisible();
    const patch = api.mock.calls.findIndex(([, init]) => init?.method === 'PATCH');
    expect(sentBody(api, patch)).toEqual({
      revision: 1,
      code: 'BR-ARI-1',
      nameTh: 'สาขาอารีย์',
      nameEn: 'Ari branch',
    });
  });

  it('keeps a code in use read-only, and supersedes the location by another of its type', async () => {
    let current = SILOM;
    const api = mockApi({
      ...catalogue(() => [PLANT, current, ARI]),
      [`POST /locations/${SILOM.id}/supersede`]: () => {
        current = { ...current, active: false, supersededBy: { id: ARI.id, code: ARI.code } };
        return jsonResponse(200, current);
      },
    });
    renderApp('/locations', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'แก้ไข สาขาสีลม' }));
    const form = screen.getByRole('form', { name: 'แก้ไข BR-SILOM' });
    const code = within(form).getByLabelText('รหัสสถานที่');
    expect(code).toHaveAttribute('readonly');
    expect(code).toHaveAccessibleDescription(/ถูกใช้แล้ว \(goods receipt GR-000001\)/);

    const by = within(form).getByLabelText('สถานที่ที่มาแทน');
    // Only active locations of the same type are offered.
    expect(
      within(by)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['เลือกสถานที่', 'BR-ARI · สาขาอารีย์']);
    expect(await axeViolations()).toEqual([]);
    await u.selectOptions(by, ARI.id);
    await u.click(within(form).getByRole('button', { name: 'แทนที่' }));

    expect(await screen.findByText('แทนที่ BR-SILOM ด้วย BR-ARI แล้ว')).toBeVisible();
    const post = api.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(api, post)).toEqual({ revision: 3, byLocationId: ARI.id });
  });

  it('offers no edit for an in-transit location', async () => {
    mockApi(catalogue(() => [PLANT, TRANSIT]));
    renderApp('/locations', { as: ADMIN });
    await screen.findByText('โรงงานบางนา');
    expect(rowOf('ระหว่างขนส่งจาก').queryByRole('button')).not.toBeInTheDocument();
    expect(rowOf('^โรงงานบางนา').getByRole('button', { name: 'แก้ไข โรงงานบางนา' })).toBeVisible();
  });

  it('says so when the code is already in use', async () => {
    mockApi({
      ...catalogue(() => [ARI]),
      [`PATCH /locations/${ARI.id}`]: () =>
        jsonResponse(422, { code: 'LOCATION_CODE_IN_USE', message: 'x' }),
    });
    renderApp('/locations', { as: ADMIN });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'แก้ไข สาขาอารีย์' }));
    await u.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'รหัสนี้ถูกใช้งานแล้วจึงเปลี่ยนไม่ได้',
    );
  });
});
