import { Injectable, UnauthorizedException } from "@nestjs/common";
import argon2 from "argon2";
import type { LoginInput, SessionUser } from "@s3gator/shared";
import { AppRole, AuthSource } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service.js";
import { LdapAuthService } from "./ldap-auth.service.js";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ldapAuthService: LdapAuthService
  ) {}

  async login(input: LoginInput): Promise<SessionUser> {
    const mode = input.mode ?? "local";

    if (mode === "ldap") {
      return this.loginWithLdap(input.username, input.password);
    }

    try {
      return await this.loginWithLocal(input.username, input.password);
    } catch {
      const ldapEnabled = await this.prisma.ldapConfig.findUnique({ where: { id: "default" } });
      if (ldapEnabled?.enabled) {
        return this.loginWithLdap(input.username, input.password);
      }
      throw new UnauthorizedException("Invalid username or password");
    }
  }

  private async loginWithLocal(username: string, password: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: {
        role: true,
        localCreds: true
      }
    });

    if (!user?.localCreds || !user.isActive) {
      throw new UnauthorizedException("Invalid username or password");
    }

    const valid = await argon2.verify(user.localCreds.passwordHash, password);

    if (!valid) {
      throw new UnauthorizedException("Invalid username or password");
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: mapRole(user.role.code)
    };
  }

  private async loginWithLdap(username: string, password: string): Promise<SessionUser> {
    const result = await this.ldapAuthService.authenticate(username, password);
    const role = await this.prisma.role.findUnique({ where: { code: result.role } });

    if (!role) {
      throw new UnauthorizedException("Role mapping failed");
    }

    const user = await this.prisma.user.upsert({
      where: { username: result.username },
      create: {
        username: result.username,
        email: result.email,
        displayName: result.displayName,
        roleId: role.id,
        source: AuthSource.LDAP
      },
      update: {
        email: result.email,
        displayName: result.displayName,
        roleId: role.id,
        source: AuthSource.LDAP,
        isActive: true
      },
      include: {
        role: true
      }
    });

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: mapRole(user.role.code)
    };
  }
}

function mapRole(role: AppRole): SessionUser["role"] {
  if (role === "SUPER_ADMIN") {
    return "SUPER_ADMIN";
  }
  if (role === "ADMIN") {
    return "ADMIN";
  }
  return "USER";
}
