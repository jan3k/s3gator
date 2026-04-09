import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { ConfigService } from "@nestjs/config";
import { AppRole } from "@prisma/client";
import type { SessionUser } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";
import { CryptoService } from "@/common/crypto.service.js";

@Injectable()
export class SessionService {
  private readonly ttlHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    configService: ConfigService
  ) {
    this.ttlHours = configService.get<number>("SESSION_TTL_HOURS", 24);
  }

  async createSession(userId: string, ipAddress?: string, userAgent?: string): Promise<{ token: string; csrfToken: string }> {
    const token = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        tokenHash: this.cryptoService.hashToken(token),
        csrfToken,
        userId,
        ipAddress,
        userAgent,
        expiresAt
      }
    });

    return { token, csrfToken };
  }

  async getSessionUser(token: string): Promise<{ user: SessionUser; sessionId: string; csrfToken: string } | null> {
    const tokenHash = this.cryptoService.hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            role: true
          }
        }
      }
    });

    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      return null;
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() }
    });

    return {
      sessionId: session.id,
      csrfToken: session.csrfToken,
      user: {
        id: session.user.id,
        username: session.user.username,
        email: session.user.email,
        displayName: session.user.displayName,
        role: mapRole(session.user.role.code)
      }
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }
}

function mapRole(value: AppRole): SessionUser["role"] {
  if (value === "SUPER_ADMIN") {
    return "SUPER_ADMIN";
  }
  if (value === "ADMIN") {
    return "ADMIN";
  }
  return "USER";
}
