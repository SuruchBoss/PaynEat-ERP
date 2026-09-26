// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/modules/audit/audit.controller.ts), see NOTICE.
import { Controller, Get, Query } from '@nestjs/common';
import type { Page } from '../../core/http/pagination.dto';
import { RequirePermissions } from '../../core/security/decorators';
import { Permission } from '../../core/security/permissions';
import { AuditService, type AuditLogView } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** The append-only trail, newest first by default. */
  @Get()
  @RequirePermissions(Permission.AUDIT_READ)
  list(@Query() query: AuditQueryDto): Promise<Page<AuditLogView>> {
    return this.audit.search(query);
  }
}
