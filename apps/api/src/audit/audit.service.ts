import { Injectable } from "@nestjs/common";
import type { SessionUser } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";
import { getRequestContext } from "@/common/request-context.js";

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
    const context = getRequestContext();

    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actor?.id,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: sanitizeAuditMetadata(
          attachContextMetadata(input.metadata, context)
        ) as object | undefined,
        ipAddress: input.ipAddress
      }
    });
  }

  async list(input: {
    limit?: number;
    search?: string;
    action?: string;
    entityType?: string;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);

    const where = {
      action: input.action
        ? {
            contains: input.action,
            mode: "insensitive" as const
          }
        : undefined,
      entityType: input.entityType
        ? {
            contains: input.entityType,
            mode: "insensitive" as const
          }
        : undefined,
      OR: input.search
        ? [
            {
              action: {
                contains: input.search,
                mode: "insensitive" as const
              }
            },
            {
              entityType: {
                contains: input.search,
                mode: "insensitive" as const
              }
            },
            {
              entityId: {
                contains: input.search,
                mode: "insensitive" as const
              }
            }
          ]
        : undefined
    };

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
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

function attachContextMetadata(
  metadata: unknown,
  context: ReturnType<typeof getRequestContext>
): unknown {
  if (!context) {
    return metadata;
  }

  const contextPayload = {
    requestId: context.requestId,
    correlationId: context.correlationId,
    source: context.source,
    jobId: context.jobId ?? null,
    userId: context.userId ?? null
  };

  if (metadata === undefined) {
    return {
      _context: contextPayload
    };
  }

  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return {
      ...(metadata as Record<string, unknown>),
      _context: contextPayload
    };
  }

  return {
    value: metadata,
    _context: contextPayload
  };
}
