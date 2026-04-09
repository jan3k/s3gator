import { Injectable, UnauthorizedException } from "@nestjs/common";
import argon2 from "argon2";
import type { LoginInput, SessionUser } from "@s3gator/shared";
import { AppRole, AuthSource } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service.js";
import { LdapAuthService } from "./ldap-auth.service.js";

type AuthMode = "local" | "ldap" | "hybrid";
type AuthMethod = "local" | "ldap";

interface AuthenticatedLoginResult {
  user: SessionUser;
  method: AuthMethod;
  authMode: AuthMode;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ldapAuthService: LdapAuthService
  ) {}

  async login(input: LoginInput): Promise<AuthenticatedLoginResult> {
    const authMode = await this.getAuthMode();
    const requestedMode = input.mode;

    if (authMode === "local") {
      if (requestedMode === "ldap") {
        throw new UnauthorizedException("LDAP login is disabled");
      }
      return {
        user: await this.loginWithLocal(input.username, input.password),
        method: "local",
        authMode
      };
    }

    if (authMode === "ldap") {
      if (requestedMode === "local") {
        throw new UnauthorizedException("Local login is disabled");
      }
      return {
        user: await this.loginWithLdap(input.username, input.password),
        method: "ldap",
        authMode
      };
    }

    if (requestedMode === "local") {
      return {
        user: await this.loginWithLocal(input.username, input.password),
        method: "local",
        authMode
      };
    }

    if (requestedMode === "ldap") {
      return {
        user: await this.loginWithLdap(input.username, input.password),
        method: "ldap",
        authMode
      };
    }

    try {
      return {
        user: await this.loginWithLocal(input.username, input.password),
        method: "local",
        authMode
      };
    } catch {
      const ldapEnabled = await this.isLdapEnabled();
      if (!ldapEnabled) {
        throw new UnauthorizedException("Invalid username or password");
      }

      return {
        user: await this.loginWithLdap(input.username, input.password),
        method: "ldap",
        authMode
      };
    }
  }

  async getAuthModeInfo(): Promise<{
    mode: AuthMode;
    ldapEnabled: boolean;
    allowedMethods: AuthMethod[];
  }> {
    const mode = await this.getAuthMode();
    const ldapEnabled = await this.isLdapEnabled();

    if (mode === "local") {
      return { mode, ldapEnabled, allowedMethods: ["local"] };
    }

    if (mode === "ldap") {
      return { mode, ldapEnabled, allowedMethods: ["ldap"] };
    }

    const allowedMethods: AuthMethod[] = ldapEnabled ? ["local", "ldap"] : ["local"];
    return { mode, ldapEnabled, allowedMethods };
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

  private async getAuthMode(): Promise<AuthMode> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: "auth_mode" },
      select: { value: true }
    });

    const value = setting?.value;
    if (value === "ldap" || value === "hybrid" || value === "local") {
      return value;
    }

    return "local";
  }

  private async isLdapEnabled(): Promise<boolean> {
    const ldapEnabled = await this.prisma.ldapConfig.findUnique({
      where: { id: "default" },
      select: { enabled: true }
    });
    return ldapEnabled?.enabled ?? false;
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
