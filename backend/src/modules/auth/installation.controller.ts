// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Controller, Get } from '@nestjs/common';
import { Public } from '../../core/security/decorators';
import { DemoInstallationService } from './demo-installation.service';

export interface InstallationInfo {
  /** ERP_DEMO=1: demo accounts with published passwords may sign in here. */
  demo: boolean;
}

/** What the console needs to know about this installation before anyone signs in. */
@Public()
@Controller('installation')
export class InstallationController {
  constructor(private readonly demo: DemoInstallationService) {}

  @Get()
  info(): InstallationInfo {
    return { demo: this.demo.isDemo() };
  }
}
