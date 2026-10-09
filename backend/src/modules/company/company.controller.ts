// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientMeta } from '../../core/http/client-meta';
import { CurrentUser, type AuthenticatedUser } from '../../core/security/current-user';
import { RequirePermissions } from '../../core/security/decorators';
import { Permission } from '../../core/security/permissions';
import { CompanyService } from './company.service';
import { UpdateCompanySettingsDto, type CompanySettingsView } from './dto/company.dto';

/**
 * The company's settings (#10). Any signed-in user reads them, as the issue opens them: whoever
 * raises a purchase order sees whether it will need an approver. Only `company_settings:manage`
 * (the admin) changes them, and every change is audited.
 */
@Controller('company/settings')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  settings(): Promise<CompanySettingsView> {
    return this.company.settings();
  }

  @Patch()
  @RequirePermissions(Permission.COMPANY_SETTINGS_MANAGE)
  update(
    @Body() dto: UpdateCompanySettingsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<CompanySettingsView> {
    return this.company.updateSettings(dto, actor, clientMeta(req));
  }
}
