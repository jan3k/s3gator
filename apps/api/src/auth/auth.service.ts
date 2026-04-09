import { Injectable, UnauthorizedException } from "@nestjs/common";
import { SpanStatusCode, trace } from "@opentelemetry/api";
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
  private readonly tracer = trace.getTracer("s3gator.api.auth");

  constructor(
    private readonly prisma: PrismaService,
    private readonly ldapAuthService: LdapAuthService
  ) {}

  async login(input: LoginInput): Promise<AuthenticatedLoginResult> {
    const span = this.tracer.startSpan("auth.login", {
      attributes: {
        username: input.username,
        requestedMode: input.mode ?? "auto"
      }
    });

    const authMode = await this.getAuthMode();
    const requestedMode = input.mode;
    span.setAttribute("auth.mode", authMode);

    try {
      if (authMode === "local") {
        if (requestedMode === "ldap") {
          throw new UnauthorizedException("LDAP login is disabled");
        }
        const resolved = {
          user: await this.loginWithLocal(input.username, input.password),
          method: "local" as const,
          authMode
        };
        span.setAttribute("auth.method", "local");
        span.setStatus({ code: SpanStatusCode.OK });
        return resolved;
      }

      if (authMode === "ldap") {
        if (requestedMode === "local") {
          throw new UnauthorizedException("Local login is disabled");
        }
        const resolved = {
          user: await this.loginWithLdap(input.username, input.password),
          method: "ldap" as const,
          authMode
        };
        span.setAttribute("auth.method", "ldap");
        span.setStatus({ code: SpanStatusCode.OK });
        return resolved;
      }

      if (requestedMode === "local") {
        const resolved = {
          user: await this.loginWithLocal(input.username, input.password),
          method: "local" as const,
          authMode
        };
        span.setAttribute("auth.method", "local");
        span.setStatus({ code: SpanStatusCode.OK });
        return resolved;
      }

      if (requestedMode === "ldap") {
        const resolved = {
          user: await this.loginWithLdap(input.username, input.password),
          method: "ldap" as const,
          authMode
        };
        span.setAttribute("auth.method", "ldap");
        span.setStatus({ code: SpanStatusCode.OK });
        return resolved;
      }

      try {
        const resolved = {
          user: await this.loginWithLocal(input.username, input.password),
          method: "local" as const,
          authMode
        };
        span.setAttribute("auth.method", "local");
        span.setStatus({ code: SpanStatusCode.OK });
        return resolved;
      } catch {
        const ldapEnabled = await this.isLdapEnabled();
        if (!ldapEnabled) {
          throw new UnauthorizedException("Invalid username or password");
        }

        const resolved = {
          user: await this.loginWithLdap(input.username, input.password),
          method: "ldap" as const,
          authMode
        };
        span.setAttribute("auth.method", "ldap");
        span.setStatus({ code: SpanStatusCode.OK });
        return resolved;
      }
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message
      });
      throw error;
    } finally {
      span.end();
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
