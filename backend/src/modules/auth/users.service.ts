import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, UserStatus, type RoleKey } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../core/errors/domain.errors';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/security/crypto.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import {
  permissionsFor,
  requiresSecondFactor,
  ROLE_KEYS,
  type Role,
} from '../../core/security/permissions';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import type { CreateUserDto, RoleView, UserView } from './dto/users.dto';
import { SessionTokensService, type ClientMeta } from './session-tokens.service';
import { UserContextService } from './user-context.service';

// The code's seven roles and the database enum must be the same set; this line stops the
// typecheck the day they are not.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const ROLES_MATCH_SCHEMA: Same<Role, RoleKey> = true;
void ROLES_MATCH_SCHEMA;

const USER_VIEW_SELECT = {
  id: true,
  email: true,
  displayName: true,
  locale: true,
  status: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: true }, orderBy: { role: 'asc' } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_VIEW_SELECT }>;

/**
 * User administration (#4): create users and give or take away the roles of ADR-0008.
 * Every change commits together with its audit entry, or not at all.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly tokens: SessionTokensService,
    private readonly userContext: UserContextService,
    private readonly audit: AuditService,
  ) {}

  roles(): RoleView[] {
    return ROLE_KEYS.map((key) => ({
      key,
      permissions: permissionsFor([key]),
      requiresSecondFactor: requiresSecondFactor([key]),
    }));
  }

  async list(): Promise<UserView[]> {
    const rows = await this.prisma.user.findMany({
      select: USER_VIEW_SELECT,
      orderBy: { email: 'asc' },
    });
    return rows.map(toView);
  }

  async get(id: string): Promise<UserView> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: USER_VIEW_SELECT });
    if (!row) throw new NotFoundError('User', id);
    return toView(row);
  }

  async create(dto: CreateUserDto, actor: AuthenticatedUser, meta: ClientMeta): Promise<UserView> {
    this.auth.assertPasswordPolicy(dto.password, dto.email);
    const passwordHash = await this.crypto.hashPassword(dto.password);
    const roles = [...new Set(dto.roles ?? [])];

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email,
            displayName: dto.displayName,
            passwordHash,
            locale: dto.locale ?? 'th',
            roles: { create: roles.map((role) => ({ role, grantedById: actor.userId })) },
          },
          select: USER_VIEW_SELECT,
        });
        await this.audit.recordWithin(tx, {
          ...byActor(actor, meta),
          action: AuditAction.CREATE,
          entityType: 'User',
          entityId: user.id,
          summary: `Created user ${user.email}`,
          changes: { email: user.email, displayName: user.displayName, locale: user.locale },
        });
        for (const role of roles) {
          await this.audit.recordWithin(
            tx,
            roleEntry(AuditAction.ROLE_GRANTED, user, role, actor, meta),
          );
        }
        return user;
      });
      return toView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('EMAIL_TAKEN', 'A user with this email already exists');
      }
      throw error;
    }
  }

  /**
   * Gives a role. Idempotent: granting a role the user already holds changes nothing and
   * records nothing. A role that makes a second factor mandatory ends the sessions of a
   * user who has none yet, so their next sign-in has to enrol first.
   */
  async grantRole(
    userId: string,
    role: Role,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<UserView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (user.roles.some((r) => r.role === role)) return user;

      await tx.userRole.create({ data: { userId, role, grantedById: actor.userId } });
      await this.audit.recordWithin(
        tx,
        roleEntry(AuditAction.ROLE_GRANTED, user, role, actor, meta),
      );

      const roles = [...user.roles.map((r) => r.role), role];
      if (requiresSecondFactor(roles) && !user.mfaEnabled) {
        await this.tokens.revokeAll(userId, 'SECOND_FACTOR_REQUIRED', tx);
      }
      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_VIEW_SELECT });
    });
    this.userContext.invalidate(userId);
    return toView(row);
  }

  /**
   * Takes a role away. Idempotent like granting. Refuses to remove `admin` from the last
   * active administrator: nobody could manage users afterwards.
   */
  async revokeRole(
    userId: string,
    role: Role,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<UserView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (!user.roles.some((r) => r.role === role)) return user;

      if (role === 'admin') {
        // Serialise every removal of `admin`, so two administrators cannot remove each
        // other at the same moment and leave none.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_roles:admin'))`;
        const otherAdmins = await tx.userRole.count({
          where: { role: 'admin', userId: { not: userId }, user: { status: UserStatus.ACTIVE } },
        });
        if (otherAdmins === 0) {
          throw new ConflictError(
            'LAST_ADMIN',
            'This is the only active administrator; give the admin role to someone else first',
          );
        }
      }

      await tx.userRole.delete({ where: { userId_role: { userId, role } } });
      await this.audit.recordWithin(
        tx,
        roleEntry(AuditAction.ROLE_REVOKED, user, role, actor, meta),
      );
      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_VIEW_SELECT });
    });
    this.userContext.invalidate(userId);
    return toView(row);
  }

  /** The user's row, locked for the rest of the transaction so role changes queue up. */
  private async lockUser(tx: Prisma.TransactionClient, userId: string): Promise<UserRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE
    `;
    if (locked.length === 0) throw new NotFoundError('User', userId);
    return tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_VIEW_SELECT });
  }
}

function toView(row: UserRow): UserView {
  const roles = row.roles.map((r) => r.role);
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    locale: row.locale,
    status: row.status,
    roles,
    mfaEnabled: row.mfaEnabled,
    mfaRequired: requiresSecondFactor(roles),
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

function byActor(actor: AuthenticatedUser, meta: ClientMeta) {
  return { actorUserId: actor.userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent };
}

function roleEntry(
  action: typeof AuditAction.ROLE_GRANTED | typeof AuditAction.ROLE_REVOKED,
  user: { id: string; email: string },
  role: Role,
  actor: AuthenticatedUser,
  meta: ClientMeta,
) {
  const verb = action === AuditAction.ROLE_GRANTED ? 'Granted' : 'Revoked';
  return {
    ...byActor(actor, meta),
    action,
    entityType: 'User',
    entityId: user.id,
    summary: `${verb} role ${role} ${action === AuditAction.ROLE_GRANTED ? 'to' : 'from'} ${user.email}`,
    changes: { role },
  };
}
