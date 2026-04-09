import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import argon2 from "argon2";
import { AuthSource } from "@prisma/client";
import type { AppRole, SessionUser } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";
import { AuditService } from "@/audit/audit.service.js";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}

  list(actor: SessionUser) {
    if (actor.role === "SUPER_ADMIN") {
      return this.prisma.user.findMany({
        orderBy: { username: "asc" },
        include: {
          role: true
        }
      });
    }

    return this.prisma.user.findMany({
      where: {
        role: {
          code: "USER"
        }
      },
      orderBy: { username: "asc" },
      include: {
        role: true
      }
    });
  }

  async createLocal(input: {
    username: string;
    email?: string;
    displayName?: string;
    password: string;
    role: AppRole;
  }, actor: SessionUser, ipAddress?: string) {
    if (actor.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only SUPER_ADMIN can create users");
    }

    const role = await this.prisma.role.findUnique({ where: { code: input.role } });
    if (!role) {
      throw new NotFoundException("Role not found");
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    const created = await this.prisma.user.create({
      data: {
        username: input.username,
        email: input.email,
        displayName: input.displayName,
        roleId: role.id,
        source: AuthSource.LOCAL,
        localCreds: {
          create: {
            passwordHash
          }
        }
      },
      include: {
        role: true
      }
    });

    await this.auditService.record({
      actor,
      action: "user.create",
      entityType: "user",
      entityId: created.id,
      metadata: {
        username: created.username,
        role: created.role.code,
        source: created.source
      },
      ipAddress
    });

    return created;
  }

  async updateUser(
    actor: SessionUser,
    userId: string,
    input: Partial<{
      email: string | null;
      displayName: string | null;
      role: AppRole;
      isActive: boolean;
      password: string;
    }>,
    ipAddress?: string
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        localCreds: true,
        role: true
      }
    });

    if (!existing) {
      throw new NotFoundException("User not found");
    }

    this.assertActorCanManageTarget(actor, existing.id, existing.role.code, input);

    const role = input.role
      ? await this.prisma.role.findUnique({
          where: { code: input.role }
        })
      : null;

    if (input.role && !role) {
      throw new NotFoundException("Role not found");
    }

    const previousRole = existing.role.code;
    const previousIsActive = existing.isActive;
    const nextRole = role?.code ?? previousRole;
    const nextIsActive = input.isActive ?? previousIsActive;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: input.email,
        displayName: input.displayName,
        isActive: input.isActive,
        roleId: role?.id
      }
    });

    let passwordChanged = false;
    if (input.password) {
      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      if (existing.localCreds) {
        await this.prisma.localCredential.update({
          where: { userId },
          data: { passwordHash }
        });
      } else {
        await this.prisma.localCredential.create({
          data: {
            userId,
            passwordHash
          }
        });
      }
      passwordChanged = true;
    }

    const updated = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true }
    });

    await this.auditService.record({
      actor,
      action: "user.update",
      entityType: "user",
      entityId: userId,
      metadata: {
        changedFields: Object.keys(input),
        roleBefore: previousRole,
        roleAfter: nextRole,
        activeBefore: previousIsActive,
        activeAfter: nextIsActive,
        passwordChanged
      },
      ipAddress
    });

    if (previousRole !== nextRole) {
      await this.auditService.record({
        actor,
        action: "user.role.change",
        entityType: "user",
        entityId: userId,
        metadata: {
          roleBefore: previousRole,
          roleAfter: nextRole
        },
        ipAddress
      });
    }

    if (previousIsActive !== nextIsActive) {
      await this.auditService.record({
        actor,
        action: nextIsActive ? "user.account.activated" : "user.account.deactivated",
        entityType: "user",
        entityId: userId,
        metadata: {
          activeBefore: previousIsActive,
          activeAfter: nextIsActive
        },
        ipAddress
      });
    }

    if (passwordChanged) {
      await this.auditService.record({
        actor,
        action: "user.password.reset",
        entityType: "user",
        entityId: userId,
        ipAddress
      });
    }

    return updated;
  }

  private assertActorCanManageTarget(
    actor: SessionUser,
    targetUserId: string,
    targetRole: AppRole,
    input: Partial<{
      role: AppRole;
      isActive: boolean;
    }>
  ): void {
    if (input.isActive === false && actor.id === targetUserId) {
      throw new ForbiddenException("You cannot deactivate your own account");
    }

    if (actor.id === targetUserId && input.role) {
      throw new ForbiddenException("ADMIN cannot change own role");
    }

    if (actor.role === "SUPER_ADMIN") {
      return;
    }

    if (actor.role !== "ADMIN") {
      throw new ForbiddenException("Insufficient role");
    }

    if (targetRole !== "USER") {
      throw new ForbiddenException("ADMIN can only manage USER accounts");
    }

    if (input.role && input.role !== "USER") {
      throw new ForbiddenException("ADMIN cannot assign elevated roles");
    }
  }
}
