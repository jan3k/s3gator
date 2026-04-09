import { Injectable } from "@nestjs/common";
import type { SessionUser } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    actor?: SessionUser;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: unknown;
    ipAddress?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actor?.id,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: sanitizeAuditMetadata(input.metadata) as object | undefined,
        ipAddress: input.ipAddress
      }
    });
  }

  async list(limit = 200) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 1000),
      include: {
        actorUser: {
          select: { id: true, username: true, email: true }
        }
      }
    });
  }
}

const REDACT_KEYS = [
  "password",
  "secret",
  "token",
  "authorization",
  "credential",
  "accesskey",
  "bindpassword"
] as const;

function sanitizeAuditMetadata(input: unknown): unknown {
  if (input === undefined) {
    return undefined;
  }

  if (input === null) {
    return null;
  }

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeAuditMetadata(item));
  }

  if (typeof input === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      const lowered = key.toLowerCase();
      if (REDACT_KEYS.some((segment) => lowered.includes(segment))) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitizeAuditMetadata(value);
      }
    }

    return result;
  }

  return String(input);
}
