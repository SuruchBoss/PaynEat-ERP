import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../core/security/current-user';
import { RequirePermissions } from '../../core/security/decorators';
import { Permission } from '../../core/security/permissions';
import { clientMeta } from './client-meta';
import { CreateUserDto, UserRoleParamsDto, type RoleView, type UserView } from './dto/users.dto';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** The seven roles of ADR-0008 and what each allows today. */
  @Get('roles')
  @RequirePermissions(Permission.USER_READ)
  roles(): RoleView[] {
    return this.users.roles();
  }

  @Get('users')
  @RequirePermissions(Permission.USER_READ)
  list(): Promise<UserView[]> {
    return this.users.list();
  }

  @Get('users/:id')
  @RequirePermissions(Permission.USER_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.get(id);
  }

  @Post('users')
  @RequirePermissions(Permission.USER_MANAGE)
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserView> {
    return this.users.create(dto, actor, clientMeta(req));
  }

  /** Idempotent: the user holds the role afterwards, whether or not they did before. */
  @Put('users/:id/roles/:role')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_MANAGE)
  grantRole(
    @Param() { id, role }: UserRoleParamsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserView> {
    return this.users.grantRole(id, role, actor, clientMeta(req));
  }

  /** Idempotent: the user does not hold the role afterwards. */
  @Delete('users/:id/roles/:role')
  @RequirePermissions(Permission.USER_MANAGE)
  revokeRole(
    @Param() { id, role }: UserRoleParamsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserView> {
    return this.users.revokeRole(id, role, actor, clientMeta(req));
  }
}
