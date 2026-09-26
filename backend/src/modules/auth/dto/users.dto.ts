import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ROLE_KEYS, type PermissionKey, type Role } from '../../../core/security/permissions';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  displayName!: string;

  /**
   * The first password, which the administrator hands over in person. The password
   * policy is checked by the service against configuration.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsIn(['th', 'en'])
  locale?: 'th' | 'en';

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ROLE_KEYS, { each: true })
  roles?: Role[];
}

/** `/users/:id/roles/:role`, validated together: the pipe sees every route parameter. */
export class UserRoleParamsDto {
  @IsUUID()
  id!: string;

  @IsIn(ROLE_KEYS)
  role!: Role;
}

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  status: 'ACTIVE' | 'DISABLED';
  roles: Role[];
  mfaEnabled: boolean;
  /** Whether the account's roles demand a second factor (ADR-0008 admin). */
  mfaRequired: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface RoleView {
  key: Role;
  permissions: PermissionKey[];
  requiresSecondFactor: boolean;
}
